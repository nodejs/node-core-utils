import { parsePRFromURL } from '../links.js';
import PRData from '../pr_data.js';
import { ascending } from '../utils.js';

const CI_URL_RE = /\/\/ci\.nodejs\.org(\S+)/mg;
export const CI_DOMAIN = 'ci.nodejs.org';

// constants
const CITGM = 'CITGM';
const CITGM_NOBUILD = 'CITGM_NOBUILD';
const PR = 'PR';
const COMMIT = 'COMMIT';
const BENCHMARK = 'BENCHMARK';
const LIBUV = 'LIBUV';
const NOINTL = 'NOINTL';
const V8 = 'V8';
const LINTER = 'LINTER';
const DAILY_MASTER = 'DAILY_MASTER';

const CI_TYPE_ENUM = {
  FULL_CI: 1 << 0,
  JOB_CI: 1 << 2
};

export const CI_PROVIDERS = {
  GITHUB: 'github-check',
  NODEJS: 'nodejs'
};

const { JOB_CI, FULL_CI } = CI_TYPE_ENUM;

export const CI_TYPES = new Map([
  [CITGM, {
    name: 'CITGM',
    jobName: 'citgm-smoker',
    pattern: /job\/citgm-smoker\/(\d+)/,
    type: JOB_CI
  }],
  [CITGM_NOBUILD, {
    name: 'CITGM',
    jobName: 'citgm-smoker-nobuild',
    pattern: /job\/citgm-smoker-nobuild\/(\d+)/,
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
  [DAILY_MASTER, {
    name: 'Node Daily Master',
    jobName: 'node-daily-master',
    pattern: /job\/node-daily-master\/(\d+)/,
    type: JOB_CI
  }]
]);

export function isFullCI(key) {
  const data = CI_TYPES.get(key);
  if (!data) {
    return false;
  }
  return !!(data.type & FULL_CI);
}

// Given a ci.nodejs.org/*** link, parse the job type and ID
export function parseJobFromURL(url) {
  if (typeof url !== 'string') {
    return undefined;
  }

  for (const [type, info] of CI_TYPES) {
    const match = url.match(info.pattern);
    if (match) {
      return {
        link: url,
        jobid: parseInt(match[1]),
        type
      };
    }
  }

  return undefined;
}

/**
 * Parse links of CI Jobs posted in a GitHub thread
 */
export class JobParser {
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

export const CI_TYPES_KEYS = {
  CITGM,
  CITGM_NOBUILD,
  PR,
  COMMIT,
  BENCHMARK,
  LIBUV,
  V8,
  NOINTL,
  LINTER,
  DAILY_MASTER
};
