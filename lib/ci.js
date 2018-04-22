'use strict';

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
const LITE_COMMIT = 'LITE_COMMIT';

const CI_TYPES = new Map([
  [CITGM, { name: 'CITGM', jobName: 'citgm-smoker' }],
  [PR, { name: 'Full PR', jobName: 'node-test-pull-request' }],
  [COMMIT, { name: 'Full Commit', jobName: 'node-test-commit' }],
  [BENCHMARK, {
    name: 'Benchmark',
    jobName: 'benchmark-node-micro-benchmarks'
  }],
  [LIBUV, { name: 'libuv', jobName: 'libuv-test-commit' }],
  [NOINTL, { name: 'No Intl', jobName: 'node-test-commit-nointl' }],
  [V8, { name: 'V8', jobName: 'node-test-commit-v8-linux' }],
  [LINTER, { name: 'Linter', jobName: 'node-test-linter' }],
  [LITE_PR, {
    name: 'Lite PR',
    jobName: 'node-test-pull-request-lite'
  }],
  [LITE_COMMIT, {
    name: 'Lite Commit',
    jobName: 'node-test-commit-lite'
  }]
]);

function parseJobFromURL(url) {
  if (typeof url !== 'string') {
    return undefined;
  }

  for (let [ type, info ] of CI_TYPES) {
    const re = new RegExp(`${CI_DOMAIN}/job/${info.jobName}/(\\d+)`);
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
    this.thread = thread;
  }

  /**
   * @returns {Map<string, {link: string, date: string}>}
   */
  parse() {
    const thread = this.thread;
    const result = new Map();
    for (const c of thread) {
      const text = c.bodyText;
      if (!text.includes(CI_DOMAIN)) continue;
      const jobs = this.parseText(text);
      for (const job of jobs) {
        const entry = result.get(job.type);
        if (!entry || entry.date < c.publishedAt) {
          result.set(job.type, {
            link: job.link,
            date: c.publishedAt,
            jobid: job.jobid
          });
        }
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

module.exports = {
  JobParser,
  CI_TYPES,
  constants: {
    CITGM, PR, COMMIT, BENCHMARK, LIBUV, V8, NOINTL,
    LINTER, LITE_PR, LITE_COMMIT
  }
};
