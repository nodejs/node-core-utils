'use strict';

function unique(arr) {
  return Array.from(new Set(arr).values());
}

function pickContext(matches, text, {
  index = 0,  // which one in the matches should be picked
  contextBefore = 0,
  contextAfter = 0
}) {
  if (index < 0) { index = matches.length + index; }
  const match = matches[index];

  const offset = text.indexOf(match);
  let after = offset + match.length;
  for (let i = 0; i < contextAfter; ++i) {
    const next = text.indexOf('\n', after + 1);
    after = next > 0 ? next : after;
  }
  let before = offset;
  for (let i = 0; i < contextBefore; ++i) {
    const next = text.lastIndexOf('\n', before - 1);
    before = next > 0 ? next : before;
  }

  return text.slice(before, after);
}

const BUILD_FAILURE = 'BUILD_FAILURE';
const JS_TEST_FAILURE = 'JS_TEST_FAILURE';
const CC_TEST_FAILURE = 'CC_TEST_FAILURE';
const JENKINS_FAILURE = 'JENKINS_FAILURE';

const FAILURE_TYPES = {
  BUILD_FAILURE, JS_TEST_FAILURE, CC_TEST_FAILURE, JENKINS_FAILURE
};

class CIFaliure {
  constructor(type, url, reason) {
    this.type = type;
    this.url = url;
    this.reason = reason;
    // Default: the first line is the highlight, we will slice
    // the context to make it so.
    // TODO: better highlights
    this.highlight = 0;
  }
}

// Usually need a fix to the build files
class BuildFailure extends CIFaliure {
  constructor(url, reason) {
    super(BUILD_FAILURE, url, reason);
  }
}

// Usually needs a fix in the test or the core
class JSTestFailure extends CIFaliure {
  constructor(url, reason) {
    super(JS_TEST_FAILURE, url, reason);
    // Example: not ok 749 parallel/test-http-readable-data-event
    this.file = this.reason.split('\n')[this.highlight].split(' ').pop();
    this.severity = this.reason.match(/^\s+severity: (\w+)/m)[1];
  }
}

// Usually needs a fix in the test or the core
class CCTestFailure extends CIFaliure {
  constructor(url, reason) {
    super(CC_TEST_FAILURE, url, reason);
  }
}

// Usually needs someone to log into the machines and fix it
class JenkinsFailure extends CIFaliure {
  constructor(url, reason) {
    super(JENKINS_FAILURE, url, reason);
  }
}

function buildFailureMatcher(patterns, url, text) {
  for (const pattern of patterns) {
    const matches = text.match(pattern.pattern);
    if (!matches) {
      continue;
    }
    const reason = pickContext(matches, text, pattern.context);
    return [new BuildFailure(url, reason)];
  }
  return null;
}

// The elements are ranked by priority
const FAILURE_FILTERS = [{
  // TODO: match indentation to avoid skipping context with '...'
  filter(url, text) {
    const pattern = /not ok[\s\S]+? {2}\.\.\.\r?\n/mg;
    const matches = text.match(pattern);
    if (!matches) {
      return null;
    }
    const nonFlaky = matches.filter((m) => !m.includes('# TODO :'));
    return unique(nonFlaky).map(match => new JSTestFailure(url, match));
  }
}, {
  filter(url, text) {
    const pattern = /\[ {2}FAILED {2}\].+/g;
    const matches = text.match(pattern);
    if (!matches) {
      return null;
    }
    const reason = pickContext(matches, text, {
      index: 0, contextBefore: 5, contextAfter: 0
    });
    return [new CCTestFailure(url, reason)];
  }
}, {
  filter(url, text) {
    const pattern = /java\.io\.IOException.+/g;
    const matches = text.match(pattern);
    if (!matches) {
      return null;
    }
    const reason = pickContext(matches, text, {
      index: -1, contextBefore: 0, contextAfter: 5
    });
    return [new JenkinsFailure(url, reason)];
  }
}, {
  filter(url, text) {
    const patterns = [{
      pattern: /ERROR: .+/g,
      // Pick the last one
      context: { index: -1, contextBefore: 0, contextAfter: 5 }
    }, {
      // Pick the first one
      pattern: /Error: .+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 5 }
    }];
    return buildFailureMatcher(patterns, url, text);
  }
}, {
  filter(url, text) {
    const pattern = /fatal: .+/g;
    const matches = text.match(pattern);
    if (!matches) {
      return [];
    }
    const reason = unique(matches).join('\n');
    return [new BuildFailure(url, reason)];
  }
}, {
  filter(url, text) {
    const patterns = [{
      pattern: /FATAL: .+/g,
      context: { index: -1, contextBefore: 0, contextAfter: 5 }
    }, {
      match: /error: .+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 5 }
    }, {
      pattern: /make.*: write error/mg,
      context: { index: 0, contextBefore: 0, contextAfter: 3 }
    }, {
      pattern: /Makefile:.+failed/g,
      context: { index: 0, contextBefore: 0, contextAfter: 5 }
    }, {
      pattern: /make.*: .+ Error \d.*/g,
      context: { index: 0, contextBefore: 0, contextAfter: 3 }
    }, {
      pattern: /warning: failed .+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 3 }
    }];
    return buildFailureMatcher(patterns, url, text);
  }
}];

class CIFailureParser {
  constructor(url, text) {
    this.url = url;
    this.text = text;
  }

  parse() {
    const text = this.text;
    for (const { filter } of FAILURE_FILTERS) {
      const result = filter(this.url, text);
      // TODO: we may want to concat certain types of failures
      if (result) {
        return result;
      }
    }
    return null;
  }
}

CIFailureParser.FAILURE_TYPES = FAILURE_TYPES;

module.exports = CIFailureParser;
