'use strict';

const Cache = require('../cache');
const CIFailureParser = require('./ci_failure_parser');
const {
  FAILURE_TYPES: {
    BUILD_FAILURE
  },
  FAILURE_CONSTRUCTORS: {
    [BUILD_FAILURE]: BuildFailure
  },
  CIResult
} = CIFailureParser;
const {
  CI_DOMAIN,
  parseJobFromURL,
  CI_TYPES
} = require('./ci_type_parser');
const qs = require('querystring');
const chalk = require('chalk');

const SUCCESS = 'SUCCESS';
const FAILURE = 'FAILURE';
const ABORTED = 'ABORTED';
const UNSTABLE = 'UNSTABLE';

const SEP_LENGTH = 120;

const TEST_PHASE = 'Binary Tests';
// com.tikal.jenkins.plugins.multijob.MultiJobBuild
const BUILD_FIELDS = 'builtOn,buildNumber,jobName,result,url';
const ACTION_TREE = 'actions[parameters[name,value]]';
const CHANGE_FIELDS = 'commitId,author[absoluteUrl,fullName],authorEmail,' +
                      'msg,date';
const CHANGE_TREE = `changeSet[items[${CHANGE_FIELDS}]]`;
const PR_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn,` +
  `subBuilds[${BUILD_FIELDS},build[subBuilds[${BUILD_FIELDS}]]]`;
const COMMIT_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn,` +
  `subBuilds[${BUILD_FIELDS}]`;
// com.tikal.jenkins.plugins.multijob.MultiJobBuild
const FANNED_TREE =
  `result,url,number,subBuilds[phaseName,${BUILD_FIELDS}],builtOn`;
// hudson.matrix.MatrixBuild
const BUILD_TREE = 'result,runs[url,number,result],builtOn';
const LINTER_TREE = 'result,url,number,builtOn';
const RUN_TREE = 'actions[causes[upstreamBuild,upstreamProject]],builtOn';

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

  async parseConsoleText() {
    const text = await this.getConsoleText();
    const parser = new CIFailureParser(this, text);
    const results = parser.parse();

    if (results) {
      this.failures = results;
      return results;
    }

    this.failures = [
      new CIResult({ url: this.jobUrl, builtOn: this.builtOn }, 'Unknown')
    ];
    return this.failures;
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

class TestBuild extends Job {
  constructor(cli, request, path, tree) {
    super(cli, request, path, tree);

    // Should be assigned in getResults()
    this.result = null;
    this.params = {};
    this.change = {};
    this.date = undefined;
    this.builds = {
      failed: [], aborted: [], pending: [], unstable: []
    };
    this.failures = [];
    this.builtOn = undefined;
  }

  setBuildData({result, changeSet, actions, timestamp, builtOn}) {
    const params = actions.find(item => typeof item.parameters === 'object');
    params.parameters.forEach(pair => {
      this.params[pair.name] = pair.value;
    });

    this.change = changeSet.items[0] || {};
    this.date = new Date(timestamp);
    this.result = result;
    this.builtOn = builtOn;
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
    if (!change.commitId) {
      return 'Unknown';
    }
    return `[${change.commitId.slice(0, 7)}] ${change.msg}`;
  }

  get author() {
    const { change } = this;
    if (!change.author) {
      return 'Unknown';
    }
    return `${change.author.fullName} <${change.authorEmail}>`;
  }

  displayHeader() {
    const { cli, result, change } = this;
    cli.separator('Summary', SEP_LENGTH);
    cli.table('Result', resultName(result));
    cli.table('URL', this.jobUrl);
    cli.table('Source', this.sourceURL);
    cli.table('Commit', this.commit);
    cli.table('Date', change.date);
    cli.table('Author', this.author);
  }

  displayFailure(failure) {
    const { cli } = this;
    const { url, reason } = failure;
    cli.separator(getNodeName(url), SEP_LENGTH);
    cli.table('URL', url);
    if (failure.type) {
      cli.table('Type', failure.type);
    }
    if (failure.builtOn) {
      cli.table('Built On', failure.builtOn);
    }
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

  displayBuilds() {
    const { cli, failures, builds } = this;
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

  display() {
    this.displayHeader();
    this.displayBuilds();
  }

  formatAsMarkdown() {
    if (this.result === SUCCESS) {
      return `Job ${this.jobUrl} is green.`;
    }
    const { failures } = this;
    let output = `Failures in job ${this.jobUrl}\n\n`;
    for (const failure of failures) {
      output += `#### [${getNodeName(failure.url)}](${failure.url})`;
      if (!failure.reason.includes('\n') && failure.reason.length < 20) {
        const builtOn = failure.builtOn ? `On ${failure.builtOn}: ` : '';
        output += `\n\n${builtOn}${failure.reason}\n`;
      } else {
        output += `\n\n`;
        const builtOn = failure.builtOn ? ` on ${failure.builtOn}:` : '';
        output += fold(`See failures${builtOn}`, failure.reason) + '\n\n';
      }
    }
    return output;
  }

  formatAsJson() {
    const result = this.failures.map(item => Object.assign({
      source: this.sourceURL,
      upstream: this.jobUrl
    }, item));
    return JSON.parse(JSON.stringify(result));
  }
}

class CommitBuild extends TestBuild {
  constructor(cli, request, id) {
    const path = `job/node-test-commit/${id}/`;
    const tree = COMMIT_TREE;
    super(cli, request, path, tree);
  }

  getBuilds({result, subBuilds}) {
    if (result === SUCCESS) {
      const builds = this.builds = {
        failed: [], aborted: [], pending: [], unstable: []
      };
      return { result: SUCCESS, builds };
    }

    const failed = subBuilds.filter(build => build.result === FAILURE);
    const aborted = subBuilds.filter(build => build.result === ABORTED);
    const pending = subBuilds.filter(build => build.result === null);
    const unstable = subBuilds.filter(build => build.result === UNSTABLE);

    // build: { buildNumber, jobName, result, url }
    const builds = this.builds = { failed, aborted, pending, unstable };
    return { result, builds };
  }

  // Get the failures and their reasons of this build
  async getResults(data) {
    const { path, cli, request } = this;
    if (!data) {
      data = await this.getBuildData();
    }
    this.setBuildData(data);
    // No builds at all
    if (data.result === FAILURE && !data.subBuilds.length) {
      const failure = new BuildFailure(this, 'Failed to trigger sub builds');
      this.failures = [failure];
      return {
        result: data.result,
        builds: { failed: [], aborted: [], pending: [], unstable: [] },
        failures: this.failures
      };
    }

    const { result, builds } = this.getBuilds(data);

    if (result !== FAILURE) {
      return { result, builds, failures: [] };
    }

    if (!builds.failed.length) {
      const failures = await this.parseConsoleText();
      return { result, builds, failures };
    }

    cli.startSpinner(`Querying failures of ${path}`);
    const promises = builds.failed.map(({jobName, buildNumber, url}) => {
      if (jobName.includes('fanned')) {
        return new FannedBuild(cli, request, jobName, buildNumber).getResults();
      } else if (jobName.includes('linter')) {
        return new LinterBuild(cli, request, jobName, buildNumber).getResults();
      } else if (jobName.includes('freestyle')) {
        return new TestRun(cli, request, url).getResults();
      }
      return new NormalBuild(cli, request, jobName, buildNumber).getResults();
    });
    const rawFailures = await Promise.all(promises);

    const failures = this.failures = flatten(rawFailures);
    cli.stopSpinner('Data downloaded');
    return { result, failures, builds };
  }
}

class PRBuild extends TestBuild {
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
    this.setBuildData(data);

    // No sub build at all
    const commitBuild = subBuilds[0];
    if (!commitBuild) {
      const failure = new BuildFailure(
        this, 'Failed to trigger node-test-commit'
      );
      Object.assign(failure, {
        source: this.sourceURL,
        upstream: this.jobUrl,
        builtOn: this.builtOn
      });
      this.failures = [failure];
      return { result, builds: {}, failures: this.failures };
    }

    // Get result from the sub build
    // assert.strictEqual(commitBuild.jobName, 'node-test-commit');
    const allBuilds = commitBuild.build.subBuilds;
    // TODO: fetch result, builtOn, timestamp in the commit build's own data
    // ..or maybe they do not worth an additional API call?
    const buildData = {
      result, subBuilds: allBuilds, changeSet, actions, timestamp
    };
    const commitBuildId = commitBuild.buildNumber;
    this.commitBuild = new CommitBuild(cli, request, commitBuildId);
    const { builds, failures } = await this.commitBuild.getResults(buildData);

    // Set up aliases for display
    this.builds = builds;
    this.failures = failures;
    return { result, builds, failures };
  }

  formatAsMarkdown() {
    if (!this.commitBuild) {
      let result = 'Failed to trigger node-test-commit';
      if (this.builtOn) {
        result += ` on ${this.builtOn}`;
      }
      result += `\n\nURL: ${this.jobUrl}`;
      return result;
    }
    return super.formatAsMarkdown();
  }
}

function filterBuild(builds, type) {
  return builds
    .filter(build => build.result === type)
    .map(build => parseJobFromURL(build.url));
}

async function listBuilds(cli, request, type) {
  // assert(type === COMMIT || type === PR)
  const { jobName } = CI_TYPES.get(type);
  const tree = `builds[url,result]`;
  const url = `https://${CI_DOMAIN}/job/${jobName}/api/json?tree=${qs.escape(tree)}`;

  cli.startSpinner(`Querying ${url}`);

  const result = await request.json(url);
  const builds = result.builds;
  const failed = filterBuild(builds, FAILURE);
  const aborted = filterBuild(builds, ABORTED);
  const pending = filterBuild(builds, null);
  const unstable = filterBuild(builds, UNSTABLE);
  const success = filterBuild(builds, SUCCESS);
  cli.stopSpinner('Done');

  return {
    success,
    failed,
    aborted,
    pending,
    unstable,
    count: builds.length
  };
}

class FannedBuild extends Job {
  constructor(cli, request, jobName, id) {
    // assert(jobName.includes('fanned'));
    const path = `job/${jobName}/${id}/`;
    const tree = FANNED_TREE;
    super(cli, request, path, tree);

    this.failures = [];
    this.builtOn = undefined;
  }

  // Get the failures and their reasons of this build
  async getResults() {
    const { cli, request } = this;
    const data = await this.getAPIData();
    this.builtOn = data.builtOn;

    if (!data.subBuilds.length) {
      this.failures = [
        new BuildFailure(this, 'Failed to trigger fanned build')
      ];
      return this.failures;
    }

    const failedPhase = data.subBuilds.find(build => build.result === FAILURE);

    if (!failedPhase) {
      return this.parseConsoleText();
    }

    if (failedPhase.phaseName !== TEST_PHASE &&
        !failedPhase.phaseName.toLowerCase().includes('compilation')) {
      this.failures = [
        new BuildFailure(
          { url: failedPhase.url, builtOn: failedPhase.builtOn },
          `Failed in ${failedPhase.phaseName} phase`
        )
      ];
      return this.failures;
    }

    const { jobName, buildNumber } = failedPhase;
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
    this.builtOn = undefined;
  }

  async getResults() {
    const data = await this.getAPIData();
    this.builtOn = data.builtOn;
    return this.parseConsoleText();
  }
}

class NormalBuild extends Job {
  constructor(cli, request, jobName, id) {
    const path = `job/${jobName}/${id}/`;
    const tree = BUILD_TREE;
    super(cli, request, path, tree);

    this.failures = [];
    this.builtOn = undefined;
  }

  async getResults() {
    const { cli, request } = this;
    const { result, runs, builtOn } = await this.getAPIData();
    this.builtOn = builtOn;

    if (result !== FAILURE) {
      this.failures = [];
      return this.failures;
    }

    if (!runs.length) {
      this.failures = [
        new BuildFailure(
          { url: this.jobUrl, builtOn }, 'Failed to trigger runs'
        )
      ];
      return this.failures;
    }

    const failed = runs.filter(run => run.result === FAILURE);

    if (!failed.length) {
      return this.parseConsoleText();
    }

    const tests = failed.map(({ url }) => new TestRun(cli, request, url));

    // Skip runs that are not actually triggered by this job
    await Promise.all(tests.map(run => run.getData()));
    const causes = tests.map(run => run.cause);
    const actualRuns = tests.filter((_, index) => {
      const upstream = causes[index].upstreamBuild;
      if (!upstream) {
        return true;
      } else {
        return this.jobUrl.includes(upstream + '');
      }
    });

    const failures = await Promise.all(
      actualRuns.map(run => run.getResults())
    );
    this.failures = flatten(failures);
    return this.failures;
  }
}

class TestRun extends Job {
  constructor(cli, request, url) {
    const path = getPath(url);
    const tree = RUN_TREE;
    super(cli, request, path, tree);

    this.failures = [];
    this.cause = {};
    this.builtOn = undefined;
  }

  async getData() {
    const data = await this.getAPIData();
    if (data.actions && data.actions.find(item => item.causes)) {
      const actions = data.actions.find(item => item.causes);
      this.cause = actions.causes[0];
    }
    this.builtOn = data.builtOn;
  }

  async getResults() {
    return this.parseConsoleText();
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
  parseJobFromURL,
  listBuilds
};
