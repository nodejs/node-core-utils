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
const GIT_FAILURE = 'GIT_FAILURE';
const NCU_FAILURE = 'NCU_FAILURE';
const RESUME_FAILURE = 'RESUME_FAILURE';
const INFRA_FAILURE = 'INFRA_FAILURE';

const FAILURE_TYPES = {
  BUILD_FAILURE, JS_TEST_FAILURE, CC_TEST_FAILURE,
  JENKINS_FAILURE, GIT_FAILURE, NCU_FAILURE, RESUME_FAILURE,
  INFRA_FAILURE
};

class CIResult {
  constructor(ctx, reason) {
    this.url = ctx.url || ctx.consoleUIUrl || ctx.jobUrl;
    this.builtOn = ctx.builtOn;
    this.reason = reason;
    // Default: the first line is the highlight, we will slice
    // the context to make it so.
    // TODO: better highlights
    this.highlight = 0;
  }
}

// Usually need a fix to the build files
class BuildFailure extends CIResult {
  constructor(ctx, reason) {
    super(ctx, reason);
    this.type = BUILD_FAILURE;
  }
}

// Usually needs to fix something in the Jenkins agent (or just restart it)
class InfraFailure extends CIResult {
  constructor(ctx, reason) {
    super(ctx, reason);
    this.type = INFRA_FAILURE;
  }
}

// Usually needs a fix in the test or the core
class JSTestFailure extends CIResult {
  constructor(ctx, reason) {
    super(ctx, reason);
    this.type = JS_TEST_FAILURE;
    // Example: not ok 749 parallel/test-http-readable-data-event
    this.file = this.reason.split('\n')[this.highlight].split(' ').pop();
    this.severity = this.reason.match(/^\s+severity: (\w+)/m)[1];
  }
}

// Usually needs a fix in the test or the core
class CCTestFailure extends CIResult {
  constructor(ctx, reason) {
    super(ctx, reason);
    this.type = CC_TEST_FAILURE;
  }
}

// Usually needs someone to log into the machines and fix it
class JenkinsFailure extends CIResult {
  constructor(ctx, reason) {
    super(ctx, reason);
    this.type = JENKINS_FAILURE;
  }
}

// Usually need a fix to the build scripts or in workers
class GitFailure extends CIResult {
  constructor(ctx, reason) {
    super(ctx, reason);
    this.type = GIT_FAILURE;
  }
}

// Failures in this tool, we wrap them to avoid exceptions when
// walking the CI
class NCUFailure extends CIResult {
  constructor(ctx, reason) {
    super(ctx, reason);
    this.type = NCU_FAILURE;
  }
}

// Refs: https://github.com/nodejs/build/issues/1496
class ResumeFailure extends CIResult {
  constructor(ctx, reason) {
    super(ctx, reason);
    this.type = RESUME_FAILURE;
  }
}

function failureMatcher(Failure, patterns, ctx, text) {
  for (const pattern of patterns) {
    const matches = text.match(pattern.pattern);
    if (!matches) {
      continue;
    }
    const reason = pickContext(matches, text, pattern.context).trim();
    return [new Failure(ctx, reason)];
  }
  return null;
}

// The elements are ranked by priority
const FAILURE_FILTERS = [{
  // NOTE(mmarchini): infra-related issues should have the highest priority, as
  // they can cause other issues to happen.
  filter(ctx, text) {
    const patterns = [{
      pattern: /Read-only file system/g,
      context: { index: 0, contextBefore: 1, contextAfter: 0 }
    },
    {
      pattern: /Device or resource busy/g,
      context: { index: 0, contextBefore: 1, contextAfter: 0 }
    },
    {
      pattern: /There is not enough space in the file system./g,
      context: { index: 0, contextBefore: 1, contextAfter: 0 }
    }
    ];
    return failureMatcher(InfraFailure, patterns, ctx, text);
  }
}, {
  // TODO: match indentation to avoid skipping context with '...'
  filter(ctx, text) {
    const pattern = /not ok \d+[\s\S]+? {2}\.\.\.\r?\n/mg;
    const matches = text.match(pattern);
    if (!matches) {
      return null;
    }
    const nonFlaky = matches.filter((m) => !m.includes('# TODO :'));
    if (!nonFlaky.length) {
      return null;
    }
    return unique(nonFlaky).map(
      match => new JSTestFailure(ctx, match)
    );
  }
}, {
  filter(ctx, text) {
    const patterns = [{
      pattern: /\[ {2}FAILED {2}\].+/g,
      context: { index: 0, contextBefore: 5, contextAfter: 0 }
    }];
    return failureMatcher(CCTestFailure, patterns, ctx, text);
  }
}, {
  // VS compilation error
  filter(ctx, text) {
    const patterns = [{
      pattern: /error C\d+:/mg,
      context: { index: 0, contextBefore: 0, contextAfter: 5 }
    }];
    return failureMatcher(BuildFailure, patterns, ctx, text);
  }
}, {
  filter(ctx, text) {
    const patterns = [{
      pattern: /java\.io\.IOException.+/g,
      context: { index: -1, contextBefore: 0, contextAfter: 5 }
    }, {
      pattern: /Build timed out/g,
      context: { index: 0, contextBefore: 0, contextAfter: 1 }
    }];
    return failureMatcher(JenkinsFailure, patterns, ctx, text);
  }
}, {
  filter(ctx, text) {
    const patterns = [{
      pattern:
        /Changes not staged for commit:[\s\S]+no changes added to commit/mg,
      context: { index: 0, contextBefore: 0, contextAfter: 0 }
    }, {
      pattern:
        // eslint-disable-next-line max-len
        /error: Your local changes to the following files[\s\S]+Failed to merge in the changes./g,
      context: { index: 0, contextBefore: 0, contextAfter: 0 }
    }, {
      pattern: /warning: failed to remove .+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 0 }
    }];
    return failureMatcher(GitFailure, patterns, ctx, text);
  }
}, {
  filter(ctx, text) {
    const patterns = [{
      pattern: /ERROR: Error fetching .+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 5 }
    }, {
      pattern: /hudson\.plugins\.git\.GitException+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 5 }
    }, {
      pattern: /Cannot rebase: .+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 1 }
    }];
    return failureMatcher(GitFailure, patterns, ctx, text);
  }
}, {
  filter(ctx, text) {
    const patterns = [{
      pattern: /sh: line /g,
      context: { index: 0, contextBefore: 0, contextAfter: 1 }
    }, {
      pattern: /fatal error:/g,
      context: { index: 0, contextBefore: 0, contextAfter: 1 }
    }, {
      pattern: /dtrace: failed to compile script/g,
      context: { index: 0, contextBefore: 0, contextAfter: 1 }
    }, {
      pattern: /ERROR: .+/g,
      // Pick the last one
      context: { index: -1, contextBefore: 0, contextAfter: 5 }
    }, {
      // Pick the first one
      pattern: /Error: .+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 5 }
    }];
    return failureMatcher(BuildFailure, patterns, ctx, text);
  }
}, {
  filter(ctx, text) {
    const pattern = /fatal: .+/g;
    const matches = text.match(pattern);
    if (!matches) {
      return null;
    }
    const reason = unique(matches).join('\n');
    return [new BuildFailure(ctx, reason)];
  }
}, {
  filter(ctx, text) {
    const patterns = [{
      pattern: /FATAL: .+/g,
      context: { index: -1, contextBefore: 0, contextAfter: 5 }
    }, {
      pattern: /make.*: write error/mg,
      context: { index: 0, contextBefore: 0, contextAfter: 3 }
    }, {
      pattern: /error: .+/g,
      context: { index: 0, contextBefore: 0, contextAfter: 5 }
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
    return failureMatcher(BuildFailure, patterns, ctx, text);
  }
}];

class CIFailureParser {
  constructor(ctx, text) {
    this.ctx = ctx;
    this.text = text;
  }

  parse() {
    const text = this.text;
    for (const { filter } of FAILURE_FILTERS) {
      const result = filter(this.ctx, text);
      // TODO: we may want to concat certain types of failures
      if (result) {
        return result;
      }
    }
    return null;
  }
}

CIFailureParser.FAILURE_TYPES = FAILURE_TYPES;
CIFailureParser.FAILURE_CONSTRUCTORS = {
  BUILD_FAILURE: BuildFailure,
  JENKINS_FAILURE: JenkinsFailure,
  JS_TEST_FAILURE: JSTestFailure,
  CC_TEST_FAILURE: CCTestFailure,
  GIT_FAILURE: GitFailure,
  NCU_FAILURE: NCUFailure,
  RESUME_FAILURE: ResumeFailure
};
CIFailureParser.CIResult = CIResult;
CIFailureParser.FAILURE_TYPES_NAME = {
  BUILD_FAILURE: 'Build Failure',
  JENKINS_FAILURE: 'Jenkins Failure',
  JS_TEST_FAILURE: 'JSTest Failure',
  CC_TEST_FAILURE: 'CCTest Failure',
  GIT_FAILURE: 'Git Failure',
  NCU_FAILURE: 'node-core-utils failure',
  RESUME_FAILURE: 'resume failure'
};
module.exports = CIFailureParser;
