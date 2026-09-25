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

// Keep both ends of large diagnostics without retaining whole lines or TAP blocks.
class FailureExcerpt {
  head = '';
  tail = '';
  length = 0;

  append(text) {
    const remaining = Math.max(0, 4096 - this.head.length);
    this.head += text.slice(0, remaining);
    this.tail = (this.tail + text.slice(remaining)).slice(-4096);
    this.length += text.length;
  }

  toString() {
    const omitted = this.length > 8192 ? '\n[... failure output truncated ...]\n' : '';
    return this.head + omitted + this.tail;
  }
}

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
    for (let offset = 0; offset < raw.length;) {
      const newline = raw.indexOf('\n', offset);
      const end = Math.min(offset + 8192, newline < 0 ? raw.length : newline + 1);
      const content = raw.slice(offset, end);
      let normalized = content.replace(/\\+/g, '/');
      if (afterBackslash && content.startsWith('\\')) normalized = normalized.slice(1);
      afterBackslash = content.endsWith('\\');
      const window = tail + normalized;
      const lineEnd = end === newline + 1;
      yield { text: window, content, lineStart, lineEnd };
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
  if (tail) yield { text: `${tail}\n`, content: '\n', lineStart, lineEnd: true };
}

// Retain failure markers and a bounded excerpt for each line.
async function * failureLines(windows, matchFile) {
  let line = {};
  let excerpt = new FailureExcerpt();
  for await (const { text, content, lineStart, lineEnd } of windows) {
    excerpt.append(content);
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
      line.text = excerpt.toString();
      yield line;
      line = {};
      excerpt = new FailureExcerpt();
    }
  }
}

async function findFailure(lines) {
  let history = [];
  let followingLines = 0;
  let diagnosticExcerpt;
  let tap = null;
  let git = null;

  for await (const line of lines) {
    const precedingLines = history;
    history = [...history, line].slice(-5);
    if (line.tapStart) {
      tap = { excerpt: new FailureExcerpt() };
      followingLines = 0;
    }
    if (tap) {
      tap.excerpt.append(line.text);
      tap.file ??= line.file;
      tap.todo ||= line.todo;
      // A later TODO can mark this as an expected failure; wait for the ending.
      if (line.tapEnd) {
        if (!tap.todo && tap.file) {
          return { filename: tap.file, reason: tap.excerpt.toString().trimEnd() };
        }
        tap = null;
      }
      continue;
    }

    if (line.gitStart) git = { excerpt: new FailureExcerpt() };
    if (git) {
      git.excerpt.append(line.text);
      git.file ??= line.file;
      if (line.gitEnd) {
        if (git.file) return { filename: git.file, reason: git.excerpt.toString().trimEnd() };
        git = null;
      }
    }
    if (line.infrastructure || line.cpp) {
      const before = line.cpp ? 5 : 1;
      const context = [...precedingLines.slice(-before), line];
      const filename = line.file || context.find(previous => previous.file)?.file;
      if (filename) {
        const excerpt = new FailureExcerpt();
        for (const previous of context) excerpt.append(previous.text);
        return { filename, reason: excerpt.toString().trimEnd() };
      }
    }
    if (line.diagnostic) {
      followingLines = 6;
      diagnosticExcerpt = new FailureExcerpt();
    }
    if (followingLines > 0) {
      followingLines--;
      diagnosticExcerpt.append(line.text);
      if (line.file) {
        return { filename: line.file, reason: diagnosticExcerpt.toString().trimEnd() };
      }
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
