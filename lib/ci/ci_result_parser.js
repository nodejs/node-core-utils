'use strict';

const {
  parsePRFromURL
} = require('../links');
const Cache = require('../cache');
const CIFailureParser = require('./ci_failure_parser');
const {
  FAILURE_TYPES: {
    BUILD_FAILURE,
    NCU_FAILURE,
    GIT_FAILURE,
    RESUME_FAILURE
  },
  FAILURE_CONSTRUCTORS: {
    [BUILD_FAILURE]: BuildFailure,
    [NCU_FAILURE]: NCUFailure,
    [RESUME_FAILURE]: ResumeFailure
  },
  CIResult,
  FAILURE_TYPES_NAME
} = CIFailureParser;
const {
  CI_DOMAIN,
  parseJobFromURL,
  CI_TYPES
} = require('./ci_type_parser');
const {
  flatten,
  shortSha
} = require('../utils');
const qs = require('querystring');
const _ = require('lodash');
const chalk = require('chalk');

const SUCCESS = 'SUCCESS';
const FAILURE = 'FAILURE';
const ABORTED = 'ABORTED';
const UNSTABLE = 'UNSTABLE';

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
const CITGM_MAIN_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn`;

// com.tikal.jenkins.plugins.multijob.MultiJobBuild
const FANNED_TREE =
  `result,url,number,subBuilds[phaseName,${BUILD_FIELDS}]`;

// hudson.matrix.MatrixBuild
const BUILD_TREE = 'result,runs[url,number,result],builtOn';
const LINTER_TREE = 'result,url,number,builtOn';
const CAUSE_TREE = 'upstreamBuild,upstreamProject,shortDescription,_class';
const RUN_TREE = `actions[causes[${CAUSE_TREE}]],builtOn`;

// hudson.tasks.test.MatrixTestResult
const RESULT_TREE = 'result[suites[cases[name,status]]]';
const CITGM_REPORT_TREE =
  `failCount,skipCount,totalCount,childReports[child[url],${RESULT_TREE}]`;

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

  async getBuildData(type = 'Build') {
    const { cli, path } = this;
    cli.startSpinner(`Querying data for ${path}`);
    const data = await this.getAPIData();
    cli.stopSpinner(`${type} data downloaded`);
    return data;
  }

  getCause(actions) {
    if (actions && actions.find(item => item.causes)) {
      const action = actions.find(item => item.causes);
      return action.causes[0];
    }
  }

  async getAPIData() {
    const { cli, request, path } = this;
    const url = this.apiUrl;
    cli.updateSpinner(`Querying API for ${path}`);
    return request.json(url);
  }

  async getConsoleText() {
    const { cli, request, path } = this;
    cli.updateSpinner(`Querying console text for ${path}`);
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
    let text;
    try {
      text = await this.getConsoleText();
    } catch (err) {
      this.failures = [
        new NCUFailure({
          url: this.consoleUrl, builtOn: this.builtOn
        }, err.message)
      ];
      return this.failures;
    }

    const parser = new CIFailureParser(this, text);
    let results = parser.parse();
    if (!results) {
      results = [
        new CIResult({ url: this.jobUrl, builtOn: this.builtOn }, 'Unknown')
      ];
    }

    this.failures = results;
    return results;
  }
}

// TODO(joyeecheung): do not cache pending jobs
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

  setBuildData({ result, changeSet, actions, timestamp, builtOn }) {
    const params = actions.find(item => typeof item.parameters === 'object');
    params.parameters.forEach(pair => {
      this.params[pair.name] = pair.value;
    });

    this.change = changeSet.items[0] || {};
    this.date = new Date(timestamp);
    this.result = result;
    this.builtOn = builtOn;
  }

  setDailyBuildData({ result, changeSet, actions, timestamp, builtOn }) {
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
    return `[${shortSha(change.commitId)}] ${change.msg}`;
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
    cli.separator('Summary');
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
    cli.separator(getNodeName(url));
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
      if (failure !== undefined) {
        this.displayFailure(failure);
      }
    }
    cli.separator('Other builds');
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
      if (failure === undefined) continue;
      output += `#### [${getNodeName(failure.url)}](${failure.url})`;
      if (!failure.reason.includes('\n') && failure.reason.length < 20) {
        const builtOn = failure.builtOn ? `On ${failure.builtOn}: ` : '';
        output += `\n\n${builtOn}${failure.reason}\n`;
      } else {
        output += '\n\n';
        const builtOn = failure.builtOn ? ` on ${failure.builtOn}:` : '';
        output += fold(`See failures${builtOn}`, failure.reason) + '\n\n';
      }
    }
    return output;
  }

  formatAsJson() {
    const { jobUrl, failures, sourceURL } = this;

    const result = failures.map(item => Object.assign({
      source: sourceURL,
      upstream: jobUrl
    }, item));

    return JSON.parse(JSON.stringify(result));
  }
}

function getHighlight(f) {
  if (!f.reason) {
    f.reason = 'failure not found';
    return f.reason;
  }
  return f.reason.split('\n')[f.highlight]
    .replace(/not ok \d+ /, '')
    .replace(
      /JNLP4-connect connection from \S+/, 'JNLP4-connect connection from ...'
    )
    .replace(/FATAL: Could not checkout \w+/, 'FATAL: Could not checkout ...')
    .replace(
      /error: pathspec .+ did not match any file\(s\) known to git/,
      'error: pathspec ... did not match any file(s) known to git')
    .replace(
      /failed: no workspace for .+/,
      'failed: no workspace for ...'
    )
    .replace(
      /fatal: loose object \w+ \(stored in .git\/objects\/.+\) is corrupt/,
      'fatal: loose object ... (stored in .git/objects/...) is corrupt')
    .replace(/hudson\.plugins\.git\.GitException: /, '')
    .replace(/java\.io\.IOException: /, '');
}

function markdownRow(...args) {
  let result = '';
  for (const item of args) {
    result += `| ${item} `;
  }
  return result + '|\n';
}

function getMachineUrl(name) {
  return `[${name}](https://${CI_DOMAIN}/computer/${name}/)`;
}

function pad(any, length) {
  return (any + '').padEnd(length);
}

const kHealthKeys = ['success', 'pending', 'aborted', 'failed', 'unstable'];
class Health {
  constructor(builds) {
    for (const key of kHealthKeys) {
      this[key] = builds[key].length;
      this.count = builds.count;
    }
  }

  // Produces a row for https://github.com/nodejs/reliability#ci-health-history
  formatAsMarkdown() {
    const { success, pending, aborted, failed, unstable, count } = this;
    const rate = `${(success / (count - pending - aborted) * 100).toFixed(2)}%`;
    // eslint-disable-next-line max-len
    let result = '| UTC Time         | RUNNING | SUCCESS | UNSTABLE | ABORTED | FAILURE | Green Rate |\n';
    // eslint-disable-next-line max-len
    result += '| ---------------- | ------- | ------- | -------- | ------- | ------- | ---------- |\n';
    const time = new Date().toISOString().slice(0, 16).replace('T', ' ');
    result += `| ${time} | ${pad(pending, 7)} | ${pad(success, 8)}|`;
    result += ` ${pad(unstable, 8)} | ${pad(aborted, 7)} | ${pad(failed, 7)} |`;
    result += ` ${pad(rate, 10)} |\n`;
    return result;
  }
}

class HealthBuild {
  constructor(cli, request, ciType, builds) {
    this.cli = cli;
    this.request = request;
    this.type = 'health';
    this.ciType = ciType;
    this.builds = builds;
    this.name = 'health';
  }

  async getResults() {
    if (!this.builds) {
      this.builds = await listBuilds(this.cli, this.request, this.ciType);
    }
    this.health = new Health(this.builds);
  }

  formatAsJson() {
    return this.health;
  }

  formatAsMarkdown() {
    return this.health.formatAsMarkdown();
  }

  display() {
    this.cli.log(this.formatAsMarkdown());
  }
}

class FailureAggregator {
  constructor(cli, data) {
    this.cli = cli;
    this.health = data[0];
    this.failures = data.slice(1);
    this.aggregates = null;
  }

  aggregate() {
    const failures = this.failures;
    const groupedByReason = _.chain(failures)
      .groupBy(getHighlight)
      .toPairs()
      .sortBy(0)
      .value();
    const data = [];
    for (const item of groupedByReason) {
      const [reason, failures] = item;
      // Uncomment this and redirect stderr away to see matched highlights
      // console.log('HIGHLIGHT', reason);

      // If multiple sub builds of one PR are failed by the same reason,
      // we'll only take one of those builds, as that might be a genuine failure
      const prs = _.chain(failures)
        .uniqBy('source')
        .sortBy((f) => parseJobFromURL(f.upstream).jobid)
        .map((item) => ({ source: item.source, upstream: item.upstream }))
        .value();
      const machines = _.uniq(failures.map(f => f.builtOn));
      data.push({
        reason, type: failures[0].type, failures, prs, machines
      });
    };

    const groupedByType = _.groupBy(data, 'type');
    for (const type of Object.keys(groupedByType)) {
      groupedByType[type] =
        _.sortBy(groupedByType[type], r => 0 - (r.prs.length));
    }
    this.aggregates = groupedByType;
    return groupedByType;
  }

  formatAsMarkdown() {
    let { aggregates } = this;
    if (!aggregates) {
      aggregates = this.aggregates = this.aggregate();
    }

    const last = parseJobFromURL(this.failures[0].upstream);
    const first = parseJobFromURL(
      this.failures[this.failures.length - 1].upstream
    );
    const jobName = CI_TYPES.get(first.type).jobName;
    let output = 'Failures in ';
    output += `[${jobName}/${first.jobid}](${first.link}) to `;
    output += `[${jobName}/${last.jobid}](${last.link}) `;
    output += 'that failed more than 2 PRs\n';
    output += '(Generated with `ncu-ci ';
    output += `${process.argv.slice(2).join(' ')}\`)\n\n`;

    output += this.health.formatAsMarkdown() + '\n';

    const todo = [];
    for (const type of Object.keys(aggregates)) {
      if (aggregates[type].length === 0) {
        continue;
      }
      output += `\n### ${FAILURE_TYPES_NAME[type]}\n\n`;
      for (const item of aggregates[type]) {
        const { reason, type, prs, failures, machines } = item;
        if (prs.length < 2) { continue; }
        todo.push({ count: prs.length, reason });
        output += markdownRow('Reason', `<code>${reason}</code>`);
        output += markdownRow('-', ':-');
        output += markdownRow('Type', type);
        const source = prs.map(f => f.source);
        output += markdownRow(
          'Failed PR', `${source.length} (${source.join(', ')})`
        );
        output += markdownRow(
          'Appeared', machines.map(getMachineUrl).join(', ')
        );
        if (prs.length > 1) {
          output += markdownRow('First CI', `${prs[0].upstream}`);
        }
        output += markdownRow('Last CI', `${prs[prs.length - 1].upstream}`);
        output += '\n';
        const example = failures[0].reason;
        output += fold(
          `<a href="${failures[0].url}">Example</a>`,
          (example.length > 1024 ? example.slice(0, 1024) + '...' : example)
        );
        output += '\n\n-------\n\n';
      }
    }

    output += '### Progress\n\n';
    output += todo.map(
      ({ count, reason }) => `- [ ] \`${reason}\` (${count})`).join('\n'
    );
    return output + '\n';
  }

  display() {
    let { cli, aggregates } = this;
    if (!aggregates) {
      aggregates = this.aggregates = this.aggregate();
    }

    for (const type of Object.keys(aggregates)) {
      cli.separator(type);
      for (const item of aggregates[type]) {
        const { reason, type, prs, failures, machines } = item;
        cli.table('Reason', reason);
        cli.table('Type', type);
        const source = prs
          .map(f => {
            const parsed = parsePRFromURL(f.source);
            return parsed ? `#${parsed.prid}` : f.source;
          });
        cli.table('Failed PR', `${source.length} (${source.join(', ')})`);
        cli.table('Appeared', machines.join(', '));
        if (prs.length > 1) {
          cli.table('First CI', `${prs[0].upstream}`);
        }
        cli.table('Last CI', `${prs[prs.length - 1].upstream}`);
        cli.log('\n' + chalk.bold('Example: ') + `${failures[0].url}\n`);
        const example = failures[0].reason;
        cli.log(example.length > 512 ? example.slice(0, 512) + '...' : example);
        cli.separator();
      }
    }
  }
}

class CommitBuild extends TestBuild {
  constructor(cli, request, id) {
    const path = `job/node-test-commit/${id}/`;
    const tree = COMMIT_TREE;
    super(cli, request, path, tree);
  }

  getBuilds({ result, subBuilds }) {
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
      try {
        data = await this.getBuildData();
      } catch (err) {
        this.failures = [
          new NCUFailure({ url: this.apiUrl }, err.message)
        ];
        return this.failures;
      }
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
    const promises = builds.failed.map(({ jobName, buildNumber, url }) => {
      if (jobName.includes('fanned')) {
        const cause = this.getCause(data.actions);
        const isResumed = cause && cause._class.includes('ResumeCause');
        return new FannedBuild(cli, request, jobName, buildNumber, isResumed)
          .getResults();
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

    let data;
    try {
      data = await this.getBuildData();
    } catch (err) {
      this.failures = [
        new NCUFailure({ url: this.apiUrl }, err.message)
      ];
      return this.failures;
    }
    const {
      result, subBuilds, changeSet, actions, timestamp
    } = data;

    // No builds found.
    if (data.status === '404') {
      const failure = new BuildFailure(this, 'No builds found for PR');
      this.failures = [failure];
      return {
        result: data.result,
        builds: { failed: [], aborted: [], pending: [], unstable: [] },
        failures: this.failures
      };
    }

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
    // Note that we have to pass the actions down to detect resume builds.
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

class CITGMBuild extends TestBuild {
  constructor(cli, request, id) {
    const path = `job/citgm-smoker/${id}/`;
    const tree = CITGM_MAIN_TREE;

    super(cli, request, path, tree);

    this.id = id;
  }

  async getResults() {
    const { id } = this;

    let headerData;
    try {
      headerData = await this.getBuildData('Summary');
    } catch (err) {
      this.failures = [
        new NCUFailure({ url: this.apiUrl }, err.message)
      ];
      return this.failures;
    }
    const { result } = headerData;

    this.setBuildData(headerData);

    // CITGM jobs store results in a different location than
    // they do summary data, so we need to update the endpoint
    // and issue a second API call in order to fetch result data.
    this.tree = CITGM_REPORT_TREE;
    this.path = `job/citgm-smoker/${this.id}/testReport/`;

    let resultData;
    try {
      resultData = await this.getBuildData('Results');
    } catch (err) {
      this.failures = [
        new NCUFailure({ url: this.apiUrl }, err.message)
      ];
      return this.failures;
    }

    this.results = this.parseResults(resultData);

    // Update id again so that it correctly displays in Summary output.
    this.path = `job/citgm-smoker/${id}/`;

    return { result };
  }

  parseResults(data) {
    const { childReports, totalCount, skipCount, failCount } = data;
    const results = { all: {}, failures: {}, statistics: {} };

    const passCount = totalCount - failCount - skipCount;
    results.statistics.passed = passCount;
    results.statistics.total = totalCount;
    results.statistics.skipped = skipCount;
    results.statistics.failed = failCount;

    childReports.forEach(platform => {
      const cases = flatten(platform.result.suites[0].cases);
      const url = platform.child.url;
      const nodeName = getNodeName(url);

      results.all[nodeName] = { url, modules: cases };

      const failedModules = cases.filter(c => c.status === 'FAILED');
      results.failures[nodeName] = { url, modules: failedModules };
    });

    return results;
  }

  displayBuilds() {
    const { cli, results } = this;
    const { failed, skipped, passed, total } = results.statistics;

    cli.separator('Statistics');
    console.table({
      Failed: failed,
      Skipped: skipped,
      Passed: passed,
      Total: total
    });

    cli.separator('Failures');
    const output = {};
    for (const platform in results.failures) {
      const modules = results.failures[platform].modules;
      const failures = modules.map(f => f.name);

      output[platform] = failures;
    }

    console.table(output);
  }

  formatAsJson() {
    const { jobUrl, results, sourceURL } = this;

    const result = {
      source: sourceURL,
      upstream: jobUrl,
      ...results.statistics,
      ...results.failures
    };

    return JSON.parse(JSON.stringify(result));
  }

  formatAsMarkdown() {
    const { jobUrl, result, results, id } = this;

    let output = `# CITGM Data for [${id}](${jobUrl})\n\n`;

    const { failed, skipped, passed, total } = results.statistics;

    output += `## Statistics for job [${id}](${jobUrl})\n\n`;
    output += '|  FAILED  |  SKIPPED  |  PASSED  |  TOTAL  |\n';
    output += '| -------- | --------- | -------- | ------- |\n';
    output += `| ${pad(failed, 8)} | ${pad(skipped, 9)} |`;
    output += ` ${pad(passed, 8)} | ${pad(total, 7)} |\n\n`;

    if (result === SUCCESS) {
      output += `Job [${id}](${jobUrl}) is green.`;
      return output;
    }

    output += `## Failures in job [${id}](${jobUrl})\n\n`;
    for (const failure in results.failures) {
      const data = results.failures[failure];
      output += `### [${failure}](${data.url})\n\n`;

      const failures = data.modules.map(f => `* ${f.name}`);
      output += `${failures.join('\n')}\n\n`;
    }
    return output;
  }
}

class DailyBuild extends TestBuild {
  constructor(cli, request, id) {
    const path = `job/node-daily-master/${id}/`;
    const tree = PR_TREE;
    super(cli, request, path, tree);

    this.commitBuild = null;
  }

  formatAsMarkdown() {
    if (!this.commitBuild) {
      let result = 'Failed to trigger node-daily-master';
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
  const tree = 'builds[url,result]';
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
  constructor(cli, request, jobName, id, isResumed) {
    // assert(jobName.includes('fanned'));
    const path = `job/${jobName}/${id}/`;
    const tree = FANNED_TREE;
    super(cli, request, path, tree);

    this.failures = [];
    this.builtOn = undefined;
    this.isResumed = isResumed;
  }

  // Get the failures and their reasons of this build
  async getResults() {
    const { cli, request } = this;

    let data;
    try {
      data = await this.getAPIData();
    } catch (err) {
      this.failures = [
        new NCUFailure({ url: this.apiUrl }, err.message)
      ];
      return this.failures;
    }
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

    const { jobName, buildNumber } = failedPhase;
    const build = new NormalBuild(cli, request, jobName, buildNumber);
    let failures = await build.getResults();
    if (failures !== undefined) {
      failures = flatten(failures);
    }

    if (this.isResumed) {
      // XXX: if it's a resumed build, we replace the build/git failures
      // with resume failures. Probably just a random guess, though
      for (let i = 0; i < failures.length; ++i) {
        const item = failures[i];
        if (item.type === BUILD_FAILURE || item.type === GIT_FAILURE) {
          failures[i] = new ResumeFailure(
            item,
            `Possible resume failure\n${item.reason}`
          );
        }
      }
    }
    this.failures = failures;
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
    let data;
    try {
      data = await this.getAPIData();
    } catch (err) {
      this.failures = [
        new NCUFailure(this, err.message)
      ];
      return this.failures;
    }
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

    let data;
    try {
      data = await this.getAPIData();
    } catch (err) {
      this.failures = [
        new NCUFailure({ url: this.apiUrl }, err.message)
      ];
      return this.failures;
    }

    const { result, runs, builtOn } = data;
    this.builtOn = builtOn;

    if (result !== FAILURE) {
      this.failures = [];
      return this.failures;
    }

    if (!runs) return [];

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
    let data;
    try {
      data = await this.getAPIData();
    } catch (err) {
      this.failures = [
        new NCUFailure({ url: this.apiUrl }, err.message)
      ];
      return this.failures;
    }
    this.causes = this.getCause(data.actions) || {};
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
    cli.separator('significant results');
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
      const [file, ...config] = name.split(' ');
      const confidence = line.match(/(\*+)/)[1];
      const lastStar = line.lastIndexOf('*');
      const [improvement, ...accuracy] =
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
  FailureAggregator,
  PRBuild,
  BenchmarkRun,
  CommitBuild,
  CITGMBuild,
  DailyBuild,
  HealthBuild,
  jobCache,
  parseJobFromURL,
  listBuilds
};
