import { StringDecoder } from 'node:string_decoder';

import { FAILURE_MARKERS, FAILURE_PATTERNS } from './ci_failure_parser.js';

function createMatcher(patterns) {
  // Preserve matching flags without sharing RegExp.lastIndex between scans.
  const matchers = patterns.map(pattern =>
    new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')));
  return text => matchers.some(pattern => pattern.test(text));
}

const diagnostic = createMatcher(FAILURE_PATTERNS.diagnostic);
const infrastructure = createMatcher(FAILURE_PATTERNS.infrastructure);
const gitStart = createMatcher(FAILURE_MARKERS.git.map(({ start }) => start));
const gitEnd = createMatcher(FAILURE_MARKERS.git.map(({ end }) => end));

function fileAliases(filename) {
  const paths = new Set([filename]);
  if (filename.startsWith('test/')) {
    paths.add(filename.slice(5));
    paths.add(filename.slice(5).replace(/\.(?:js|mjs|cjs|out)$/, ''));
  } else if (filename.startsWith('lib/')) {
    paths.add(filename.slice(4));
  }
  return [...paths];
}

// Emit overlapping, normalized windows rather than buffering whole log lines.
// Explicit line boundaries keep network chunk boundaries out of the matching rules.
async function * logWindows(source, overlap) {
  const decoder = new StringDecoder('utf8');
  let tail = '';
  let lineStart = true;
  let afterBackslash = false;

  function * consume(raw) {
    raw = raw.replace(/\r/g, '');
    let text = raw.replace(/\\+/g, '/');
    if (afterBackslash && raw.startsWith('\\')) text = text.slice(1);
    if (raw) afterBackslash = raw.endsWith('\\');
    for (let offset = 0; offset < text.length;) {
      const newline = text.indexOf('\n', offset);
      const end = Math.min(offset + 8192, newline < 0 ? text.length : newline + 1);
      const window = tail + text.slice(offset, end);
      const lineEnd = end === newline + 1;
      yield { text: window, lineStart, lineEnd };
      if (lineEnd) {
        tail = '';
        lineStart = true;
      } else {
        lineStart &&= window.length <= overlap;
        tail = window.slice(-overlap);
      }
      offset = end;
    }
  }

  for await (const chunk of source) yield * consume(decoder.write(chunk));
  yield * consume(decoder.end());
  if (tail) yield { text: `${tail}\n`, lineStart, lineEnd: true };
}

// Each line is reduced to a filename and failure markers. Neither a giant line
// nor a giant TAP block needs to survive in memory.
async function * failureLines(windows, matchFile) {
  let line = {};
  for await (const { text, lineStart, lineEnd } of windows) {
    line.file ??= matchFile(text, lineStart);
    line.diagnostic ||= diagnostic(text);
    line.infrastructure ||= infrastructure(text);
    line.cpp ||= FAILURE_MARKERS.cpp.test(text);
    line.tapStart ||= lineStart && FAILURE_MARKERS.tap.start.test(text);
    line.tapEnd ||= lineEnd && FAILURE_MARKERS.tap.end.test(text);
    line.todo ||= text.includes(FAILURE_MARKERS.tap.todo);
    line.gitStart ||= gitStart(text);
    line.gitEnd ||= gitEnd(text);
    if (lineEnd) {
      yield line;
      line = {};
    }
  }
}

async function findFailure(lines) {
  let history = [];
  let followingLines = 0;
  let tap = null;
  let git = null;

  for await (const line of lines) {
    const precedingLines = history;
    history = [...history, line.file].slice(-5);
    if (line.tapStart) {
      tap = {};
      followingLines = 0;
    }
    if (tap) {
      tap.file ??= line.file;
      tap.todo ||= line.todo;
      // A later TODO can mark this as an expected failure; wait for the ending.
      if (line.tapEnd) {
        if (!tap.todo && tap.file) return tap.file;
        tap = null;
      }
      continue;
    }

    if (line.gitStart) git = {};
    if (git) {
      git.file ??= line.file;
      if (line.gitEnd) {
        if (git.file) return git.file;
        git = null;
      }
    }
    if (line.infrastructure || line.cpp) {
      const before = line.cpp ? 5 : 1;
      const file = line.file || precedingLines.slice(-before).find(Boolean);
      if (file) return file;
    }
    if (line.diagnostic) followingLines = 6;
    if (followingLines > 0) {
      followingLines--;
      if (line.file) return line.file;
    }
  }
}

export class FailureFileScanner {
  constructor(filenames) {
    const aliases = [...filenames].map(filename => ({ filename, paths: fileAliases(filename) }));
    this.overlap = Math.max(256,
      ...aliases.flatMap(({ paths }) => paths.map(path => path.length + 2)));
    const matchers = aliases.map(({ filename, paths }) => ({
      filename,
      patterns: paths.map(path => {
        const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Both delimiters must be real: a window boundary is not a path boundary.
        return new RegExp(`[^\\w.-]${escaped}(?=[^\\w./-])`);
      })
    }));
    this.matchFile = (text, lineStart) => {
      // The start of a real log line is also a valid left delimiter.
      if (lineStart) text = `\n${text}`;
      return matchers.find(({ patterns }) =>
        patterns.some(pattern => pattern.test(text)))?.filename;
    };
  }

  scan(source) {
    return findFailure(failureLines(logWindows(source, this.overlap), this.matchFile));
  }
}
