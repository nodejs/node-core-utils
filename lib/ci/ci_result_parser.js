'use strict';

const { parsePRFromURL } = require('../links');
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
  FAILURE_TYPES_NAME
} = CIFailureParser;
const {
  CI_DOMAIN,
  parseJobFromURL,
  CI_TYPES
} = require('./ci_type_parser');
const {
  BUILD_TREE,
  COMMIT_TREE,
  FANNED_TREE,
  LINTER_TREE,
  PR_TREE,
  RUN_TREE
} = require('./jenkins_constants');
const { fold, statusType, pad } = require('./ci_utils');

const { Job, jobCache } = require('./build-types/job');
const { TestBuild } = require('./build-types/test_build');
const { CITGMBuild } = require('./build-types/citgm_build');
const {
  CITGMComparisonBuild
} = require('./build-types/citgm_comparison_build');
const { flatten } = require('../utils');
const qs = require('querystring');
const _ = require('lodash');
const chalk = require('chalk');

function getPath(url) {
  return url.replace(`https://${CI_DOMAIN}/`, '').replace('api/json', '');
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
    if (result === statusType.SUCCESS) {
      const builds = this.builds = {
        failed: [], aborted: [], pending: [], unstable: []
      };
      return { result: statusType.SUCCESS, builds };
    }

    const failed = subBuilds.filter(build => {
      return build.result === statusType.FAILURE;
    });
    const aborted = subBuilds.filter(build => {
      return build.result === statusType.ABORTED;
    });
    const pending = subBuilds.filter(build => {
      return build.result === null;
    });
    const unstable = subBuilds.filter(build => {
      return build.result === statusType.UNSTABLE;
    });

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
    if (data.result === statusType.FAILURE && !data.subBuilds.length) {
      const failure = new BuildFailure(this, 'Failed to trigger sub builds');
      this.failures = [failure];
      return {
        result: data.result,
        builds: { failed: [], aborted: [], pending: [], unstable: [] },
        failures: this.failures
      };
    }

    const { result, builds } = this.getBuilds(data);

    if (result !== statusType.FAILURE) {
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
  const failed = filterBuild(builds, statusType.FAILURE);
  const aborted = filterBuild(builds, statusType.ABORTED);
  const pending = filterBuild(builds, null);
  const unstable = filterBuild(builds, statusType.UNSTABLE);
  const success = filterBuild(builds, statusType.SUCCESS);
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

    const failedPhase = data.subBuilds.find(build => {
      return build.result === statusType.FAILURE;
    });

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

    if (result !== statusType.FAILURE) {
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

    const failed = runs.filter(run => {
      return run.result === statusType.FAILURE;
    });

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
  CITGMComparisonBuild,
  HealthBuild,
  jobCache,
  parseJobFromURL,
  listBuilds
};
