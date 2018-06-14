'use strict';

const Cache = require('./cache');
const PRData = require('./pr_data');
const CIParser = require('./ci_failure_parser');
const { parsePRFromURL } = require('./links');
const qs = require('querystring');
const chalk = require('chalk');

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

const SUCCESS = 'SUCCESS';
const FAILURE = 'FAILURE';
const ABORTED = 'ABORTED';
const UNSTABLE = 'UNSTABLE';

const SEP_LENGTH = 120;

const TEST_PHASE = 'Binary Tests';
// com.tikal.jenkins.plugins.multijob.MultiJobBuild
const BUILD_FIELDS = 'buildNumber,jobName,result,url';
const ACTION_TREE = 'actions[parameters[name,value]]';
const CHANGE_FIELDS = 'commitId,author[absoluteUrl,fullName],authorEmail,' +
                      'msg,date';
const CHANGE_TREE = `changeSet[items[${CHANGE_FIELDS}]]`;
const PR_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},` +
  `subBuilds[${BUILD_FIELDS},build[subBuilds[${BUILD_FIELDS}]]]`;
const COMMIT_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},subBuilds[${BUILD_FIELDS}]`;
// com.tikal.jenkins.plugins.multijob.MultiJobBuild
const FANNED_TREE = `result,url,number,subBuilds[phaseName,${BUILD_FIELDS}]`;
// hudson.matrix.MatrixBuild
const BUILD_TREE = 'result,runs[url,number,result]';
const LINTER_TREE = 'result,url,number';

function getPath(url) {
  return url.replace(`https://${CI_DOMAIN}/`, '').replace('api/json', '');
}

function getUrl(path) {
  return `https://${CI_DOMAIN}/${getPath(path)}`;
}

function resultName(result) {
  return result === null ? 'PENDING' : result.toUpperCase();
}

function fold(summary, code) {
  const dataBlock = '```\n' + code + '\n```';
  const summaryBlock = `\n<summary>${summary}</summary>\n`;
  return `<details>${summaryBlock}\n${dataBlock}\n</details>`;
}

/*
function getJobName(url) {
  return url.match(/job\/(.+?)\//)[1];
}
*/

function getNodeName(url) {
  const re = /\/nodes=(.+?)\//;
  if (re.test(url)) {
    return url.match(re)[1];
  }
  const parts = url.split('/');
  return parts[parts.length - 3];
}

function flatten(arr) {
  let result = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      result = result.concat(flatten(item));
    } else {
      result.push(item);
    }
  }
  return result;
}

class Job {
  constructor(cli, request, path, tree) {
    this.cli = cli;
    this.request = request;
    this.path = path;
    this.tree = tree;
  }

  get jobUrl() {
    const { path } = this;
    return `https://${CI_DOMAIN}/${path}`;
  }

  get apiUrl() {
    const { tree } = this;
    const query = tree ? `?tree=${qs.escape(tree)}` : '';
    return `${this.jobUrl}api/json${query}`;
  }

  get consoleUrl() {
    const { path } = this;
    return `https://${CI_DOMAIN}/${path}consoleText`;
  }

  get consoleUIUrl() {
    const { path } = this;
    return `https://${CI_DOMAIN}/${path}console`;
  }

  async getBuildData() {
    const { cli, path } = this;
    cli.startSpinner(`Querying data of ${path}`);
    const data = await this.getAPIData();
    cli.stopSpinner('Build data downloaded');
    return data;
  }

  async getAPIData() {
    const { cli, request, path } = this;
    const url = this.apiUrl;
    cli.updateSpinner(`Querying API of ${path}`);
    return request.json(url);
  }

  async getConsoleText() {
    const { cli, request, path } = this;
    cli.updateSpinner(`Querying console text of ${path}`);
    const data = await request.text(this.consoleUrl);
    return data.replace(/\r/g, '');
  }

  getCacheKey() {
    return this.path
      .replace(/job\//, '')
      .replace(/\//g, '-')
      .replace(/-$/, '');
  }
}

const jobCache = new Cache();
jobCache.wrap(Job, {
  getConsoleText() {
    return { key: this.getCacheKey(), ext: '.txt' };
  },
  getAPIData() {
    return { key: this.getCacheKey(), ext: '.json' };
  }
});

class CommitBuild extends Job {
  constructor(cli, request, id) {
    const path = `job/node-test-commit/${id}/`;
    const tree = COMMIT_TREE;
    super(cli, request, path, tree);

    this.result = null;
    this.builds = {};
    this.failures = [];
    this.params = {};
    this.change = {};
    this.date = undefined;
  }

  getBuilds({result, subBuilds, changeSet, actions, timestamp}) {
    const params = actions.find(item => typeof item.parameters === 'object');
    params.parameters.forEach(pair => {
      this.params[pair.name] = pair.value;
    });

    this.change = changeSet.items[0];
    this.date = new Date(timestamp);

    // build: { buildNumber, jobName, result, url }
    this.result = result;

    if (result === SUCCESS) {
      const builds = this.builds = {
        failed: [], aborted: [], pending: [], unstable: []
      };
      return { result: SUCCESS, builds };
    }

    const allBuilds = subBuilds;
    const failed = allBuilds.filter(build => build.result === FAILURE);
    const aborted = allBuilds.filter(build => build.result === ABORTED);
    const pending = allBuilds.filter(build => build.result === null);
    const unstable = allBuilds.filter(build => build.result === UNSTABLE);

    const builds = this.builds = { failed, aborted, pending, unstable };
    return { result, builds };
  }

  // Get the failures and their reasons of this build
  async getResults(data) {
    const { path, cli, request } = this;
    if (!data) {
      data = await this.getBuildData();
    }
    const { result, builds } = this.getBuilds(data);
    if (result === SUCCESS || !builds.failed.length) {
      return { result };
    }

    cli.startSpinner(`Querying failures of ${path}`);
    const promises = builds.failed.map(({jobName, buildNumber}) => {
      if (jobName.includes('fanned')) {
        return new FannedBuild(cli, request, jobName, buildNumber).getResults();
      } else if (jobName.includes('linter')) {
        return new LinterBuild(cli, request, jobName, buildNumber).getResults();
      }
      return new NormalBuild(cli, request, jobName, buildNumber).getResults();
    });
    const rawFailures = await Promise.all(promises);

    // failure: { url, reason }
    const failures = this.failures = flatten(rawFailures);
    cli.stopSpinner('Data downloaded');
    return { result, failures, builds };
  }

  get sourceURL() {
    const { params } = this;

    if (params.PR_ID) {  // from a node-test-pull-request build
      const owner = params.TARGET_GITHUB_ORG;
      const repo = params.TARGET_REPO_NAME;
      const prid = params.PR_ID;
      return `https://github.com/${owner}/${repo}/pull/${prid}/`;
    }

    if (params.GITHUB_ORG) {  // from a node-test-commit build
      const owner = params.GITHUB_ORG;
      const repo = params.REPO_NAME;
      const prm = params.GIT_REMOTE_REF.match(/refs\/pull\/(\d+)\/head/);
      if (prm) {
        return `https://github.com/${owner}/${repo}/pull/${prm[1]}/`;
      } else {
        const result =
          `https://api.github.com/repos/${owner}/${repo}/git/` +
          params.GIT_REMOTE_REF;
        return result;
      }
    }
  }

  get commit() {
    const { change } = this;
    return `[${change.commitId.slice(0, 7)}] ${change.msg}`;
  }

  get author() {
    const { change } = this;
    return `${change.author.fullName} <${change.authorEmail}>`;
  }

  displayFailure(failure) {
    const { cli } = this;
    const { url, reason } = failure;
    cli.separator(getNodeName(url), SEP_LENGTH);
    cli.table('URL', url);
    if (!reason.includes('\n') && reason.length < 40) {
      cli.table('Reason', chalk.red(reason));
    } else {
      cli.table('Reason', '');
      const lines = reason.split('\n');
      cli.log(`  ${chalk.red(lines[0])}`);
      for (let i = 1; i < lines.length; ++i) {
        cli.log(`  ${lines[i]}`);
      }
    }
  }

  display() {
    const { cli, result, failures, change, builds } = this;
    cli.separator('Summary', SEP_LENGTH);
    cli.table('Result', resultName(result));
    cli.table('URL', this.jobUrl);
    cli.table('Source', this.sourceURL);
    cli.table('Commit', this.commit);
    cli.table('Date', change.date);
    cli.table('Author', this.author);
    for (const failure of failures) {
      this.displayFailure(failure);
    }
    cli.separator('Other builds', SEP_LENGTH);
    for (const aborted of builds.aborted) {
      cli.table('Aborted', getUrl(aborted.url));
    }
    for (const pending of builds.pending) {
      cli.table('Pending', getUrl(pending.url));
    }
    for (const unstable of builds.unstable) {
      cli.table('Unstable', getUrl(unstable.url));
    }
  }

  formatAsMarkdown() {
    if (this.result === SUCCESS) {
      return `Job ${this.jobUrl} is green.`;
    }
    const { failures } = this;
    let output = `Failures in job ${this.jobUrl} \n\n`;
    for (const failure of failures) {
      output += `#### [${getNodeName(failure.url)}](${failure.url})`;
      if (!failure.reason.includes('\n') && failure.reason.length < 20) {
        output += `: ${failure.reason}\n`;
      } else {
        output += `\n\n`;
        output += fold('See failures', failure.reason) + '\n\n';
      }
    }
    return output;
  }

  formatAsJson() {
    return JSON.parse(JSON.stringify(this.failures));
}

class PRBuild extends Job {
  constructor(cli, request, id) {
    const path = `job/node-test-pull-request/${id}/`;
    const tree = PR_TREE;
    super(cli, request, path, tree);

    this.commitBuild = null;
  }

  // Get the failures and their reasons of this build
  async getResults() {
    const { cli, request } = this;
    const data = await this.getBuildData();
    const {
      result, subBuilds, changeSet, actions, timestamp
    } = data;

    const commitBuild = subBuilds[0];
    // assert.strictEqual(commitBuild.jobName, 'node-test-commit');
    const allBuilds = commitBuild.build.subBuilds;
    const buildData = {
      result, subBuilds: allBuilds, changeSet, actions, timestamp
    };
    const commitBuildId = commitBuild.buildNumber;
    this.commitBuild = new CommitBuild(cli, request, commitBuildId);
    return this.commitBuild.getResults(buildData);
  }

  display() {
    this.commitBuild.display();
  }

  formatAsMarkdown() {
    return this.commitBuild.formatAsMarkdown();
  }

  formatAsJson() {
    return this.commitBuild.formatAsJson();
}

class FannedBuild extends Job {
  constructor(cli, request, jobName, id) {
    // assert(jobName.includes('fanned'));
    const path = `job/${jobName}/${id}/`;
    const tree = FANNED_TREE;
    super(cli, request, path, tree);

    this.failures = [];
  }

  // Get the failures and their reasons of this build
  async getResults() {
    const { cli, request } = this;
    const data = await this.getAPIData();
    const test = data.subBuilds.find(build => build.phaseName === TEST_PHASE);

    if (!test) {
      this.failures = [{ url: this.jobUrl, reason: 'No test phase' }];
      return this.failures;
    }

    if (test.result === SUCCESS) {
      this.failures = [];
      return this.failures;
    }

    if (test.result !== FAILURE) {
      this.failures = [{
        url: this.jobUrl,
        reason: `Result: ${resultName(test.result)}`
      }];
      return this.failures;
    }

    const { jobName, buildNumber } = test;
    const build = new NormalBuild(cli, request, jobName, buildNumber);
    const failures = await build.getResults();
    this.failures = flatten(failures);
    return this.failures;
  }
}

class LinterBuild extends Job {
  constructor(cli, request, jobName, id) {
    const path = `job/${jobName}/${id}/`;
    const tree = LINTER_TREE;
    super(cli, request, path, tree);

    this.failures = [];
  }

  async getResults() {
    const data = await this.getConsoleText();
    const parser = new CIParser(this.consoleUIUrl, data);
    const results = parser.parse();
    if (results) {
      this.failures = results;
      return results;
    }

    this.failures = [{
      url: this.jobUrl,
      reason: 'Unknown'
    }];
    return this.failures;
  }
}

class NormalBuild extends Job {
  constructor(cli, request, jobName, id) {
    const path = `job/${jobName}/${id}/`;
    const tree = BUILD_TREE;
    super(cli, request, path, tree);

    this.failures = [];
  }

  async getResults() {
    const { cli, request } = this;
    const { result, runs } = await this.getAPIData();
    if (result === SUCCESS) {
      this.failures = [];
      return this.failures;
    }
    if (result !== FAILURE) {
      this.failures = [{
        url: this.jobUrl,
        reason: `Result: ${resultName(result)}`
      }];

      return this.failures;
    }
    const failed = runs.filter(run => run.result === FAILURE);
    const promises = failed.map(
      ({ url }) => new TestRun(cli, request, url).getResults()
    );
    const failures = await Promise.all(promises);
    this.failures = flatten(failures);
    return this.failures;
  }
}

class TestRun extends Job {
  constructor(cli, request, url) {
    const path = getPath(url);
    super(cli, request, path);

    this.failures = [];
  }

  async getResults() {
    const data = await this.getConsoleText();
    const parser = new CIParser(this.consoleUIUrl, data);
    const results = parser.parse();
    if (results) {
      this.failures = results;
      return results;
    }

    this.failures = [{
      url: this.jobUrl,
      reason: 'Unknown'
    }];
    return this.failures;
  }
}

class BenchmarkRun extends Job {
  constructor(cli, request, id) {
    const path = `job/benchmark-node-micro-benchmarks/${id}/`;
    super(cli, request, path);

    this.results = '';
    this.significantResults = '';
  }

  async getResults() {
    const { path, cli } = this;
    cli.startSpinner(`Querying results of ${path}`);
    const text = await this.getConsoleText();
    const index = text.indexOf('improvement');
    if (index === -1) {
      throw new Error('Not finished');
    }
    const breakIndex = text.lastIndexOf('\n', index);
    const results = text.slice(breakIndex + 1)
      .replace(/\nSending e-mails[\s\S]+/mg, '');
    this.results = results;
    cli.stopSpinner('Data downloaded');
    this.significantResults = this.getSignificantResults(results);
    return results;
  }

  getSignificantResults(data) {
    const lines = data.split('\n');
    const significant = lines.filter(line => line.indexOf('*') !== -1);
    return significant.slice(0, -3).join('\n');
  }

  display() {
    const { cli, results, significantResults } = this;
    cli.log(results);
    cli.separator('significant results', SEP_LENGTH);
    cli.log(significantResults);
  }

  formatAsMarkdown() {
    const { results, significantResults } = this;
    const output = (fold('Benchmark results', results) + '\n\n' +
                    fold('Significant impact', significantResults) + '\n');
    return output;
  }

  formatAsJson() {
    const results = this.significantResults.split('\n').slice(1);
    const json = [];
    for (const line of results) {
      const star = line.indexOf('*');
      const name = line.slice(0, star).trim();
      const [ file, ...config ] = name.split(' ');
      const confidence = line.match(/(\*+)/)[1];
      const lastStar = line.lastIndexOf('*');
      const [ improvement, ...accuracy ] =
        line.slice(lastStar + 1).split(/\s*%/).map(i => i.trim() + '%');
      accuracy.pop(); // remove the last empty item
      json.push({
        file,
        config,
        confidence,
        improvement,
        accuracy
      });
    }
    return json;
  }
}

module.exports = {
  PRBuild,
  BenchmarkRun,
  CommitBuild,
  jobCache,
  JobParser,
  CI_TYPES,
  constants: {
    CITGM, PR, COMMIT, BENCHMARK, LIBUV, V8, NOINTL,
    LINTER, LITE_PR, LITE_COMMIT
  },
  parseJobFromURL
};
