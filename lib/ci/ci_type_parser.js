'use strict';

const { parsePRFromURL } = require('../links');
const PRData = require('../pr_data');
const { ascending } = require('../comp');

const CI_URL_RE = /\/\/ci\.nodejs\.org(\S+)/mg;
const CI_DOMAIN = 'ci.nodejs.org';

// constants
const CITGM = 'CITGM';
const PR = 'PR';
const COMMIT = 'COMMIT';
const BENCHMARK = 'BENCHMARK';
const LIBUV = 'LIBUV';
const NOINTL = 'NOINTL';
const V8 = 'V8';
const LINTER = 'LINTER';
const LITE_PR = 'LITE_PR';
const LITE_PR_PIPELINE = 'LITE_PR_PIPELINE';
const LITE_COMMIT = 'LITE_COMMIT';

const CI_TYPE_ENUM = {
  FULL_CI: 1 << 0,
  LITE_CI: 1 << 1,
  JOB_CI: 1 << 2
};

const { JOB_CI, FULL_CI, LITE_CI } = CI_TYPE_ENUM;

const CI_TYPES = new Map([
  [CITGM, {
    name: 'CITGM',
    jobName: 'citgm-smoker',
    pattern: /job\/citgm-smoker\/(\d+)/,
    type: JOB_CI
  }],
  [PR, {
    name: 'Full PR',
    jobName: 'node-test-pull-request',
    pattern: /job\/node-test-pull-request\/(\d+)/,
    type: JOB_CI | FULL_CI
  }],
  [COMMIT, {
    name: 'Full Commit',
    jobName: 'node-test-commit',
    pattern: /job\/node-test-commit\/(\d+)/,
    type: JOB_CI | FULL_CI
  }],
  [BENCHMARK, {
    name: 'Benchmark',
    jobName: 'benchmark-node-micro-benchmarks',
    pattern: /job\/benchmark-node-micro-benchmarks\/(\d+)/,
    type: JOB_CI
  }],
  [LIBUV, {
    name: 'libuv',
    jobName: 'libuv-test-commit',
    pattern: /job\/libuv-test-commit\/(\d+)/,
    type: JOB_CI
  }],
  [NOINTL, {
    name: 'No Intl',
    jobName: 'node-test-commit-nointl',
    pattern: /job\/node-test-commit-nointl\/(\d+)/,
    type: JOB_CI
  }],
  [V8, {
    name: 'V8',
    jobName: 'node-test-commit-v8-linux',
    pattern: /job\/node-test-commit-v8-linux\/(\d+)/,
    type: JOB_CI
  }],
  [LINTER, {
    name: 'Linter',
    jobName: 'node-test-linter',
    pattern: /job\/node-test-linter\/(\d+)/,
    type: JOB_CI
  }],
  [LITE_PR, {
    name: 'Lite PR',
    jobName: 'node-test-pull-request-lite',
    pattern: /job\/node-test-pull-request-lite\/(\d+)/,
    type: JOB_CI | LITE_CI
  }],
  [LITE_PR_PIPELINE, {
    name: 'Lite PR Pipeline',
    jobName: 'node-test-pull-request-lite-pipeline',
    pattern: /job\/node-test-pull-request-lite-pipeline\/(\d+)\/pipeline/,
    type: LITE_CI
  }],
  [LITE_COMMIT, {
    name: 'Lite Commit',
    jobName: 'node-test-commit-lite',
    pattern: /job\/node-test-commit-lite\/(\d+)/,
    type: JOB_CI | LITE_CI
  }]
]);

function isFullCI(key) {
  const data = CI_TYPES.get(key);
  if (!data) {
    return false;
  }
  return !!(data.type & FULL_CI);
}

function isLiteCI(key) {
  const data = CI_TYPES.get(key);
  if (!data) {
    return false;
  }
  return !!(data.type & LITE_CI);
}

// Given a ci.nodejs.org/*** link, parse the job type and ID
function parseJobFromURL(url) {
  if (typeof url !== 'string') {
    return undefined;
  }

  for (let [ type, info ] of CI_TYPES) {
    const re = new RegExp(`job/${info.jobName}/(\\d+)`);
    const match = url.match(re);
    if (match) {
      return {
        link: url,
        jobid: parseInt(match[1]),
        type: type
      };
    }
  }

  return undefined;
}

/**
 * Parse links of CI Jobs posted in a GitHub thread
 */
class JobParser {
  /**
   * @param {{bodyText: string, publishedAt: string}[]} thread
   */
  constructor(thread) {
    this.thread = thread.sort(
      (a, b) => ascending(a.publishedAt, b.publishedAt)
    );
  }

  /**
   * @returns {Map<string, {link: string, date: string, jobid: number}>}
   */
  parse() {
    const thread = this.thread;
    const result = new Map();
    for (const c of thread) {
      const text = c.bodyText;
      if (!text.includes(CI_DOMAIN)) continue;
      const jobs = this.parseText(text);
      for (const job of jobs) {
        // Always take the last one
        // TODO(joyeecheung): exlcude links wrapped in `<del>`
        result.set(job.type, {
          link: job.link,
          date: c.publishedAt,
          jobid: job.jobid
        });
      }
    }
    return result;
  }

  /**
   * @param {string} text
   * @returns {{link: string, jobid: number, type: string}}
   */
  parseText(text) {
    const links = text.match(CI_URL_RE);
    if (!links) {
      return [];
    }

    const result = [];
    for (const link of links) {
      const parsed = parseJobFromURL(`https:${link}`);
      if (parsed) {
        result.push(parsed);
      }
    }

    return result;
  }
}

JobParser.fromPR = async function(url, cli, request) {
  const argv = parsePRFromURL(url);
  if (!argv) {
    return undefined;
  }
  const data = new PRData(argv, cli, request);
  await data.getThreadData();
  const thread = data.getThread();
  return new JobParser(thread);
};

module.exports = {
  CI_DOMAIN,
  CI_TYPES,
  CI_TYPES_KEYS: {
    CITGM, PR, COMMIT, BENCHMARK, LIBUV, V8, NOINTL,
    LINTER, LITE_PR, LITE_COMMIT
  },
  isFullCI,
  isLiteCI,
  JobParser,
  parseJobFromURL
};
