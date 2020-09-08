'use strict';

const chalk = require('chalk');
const { Job } = require('./job');
const { shortSha } = require('../../utils');
const {
  fold,
  getNodeName,
  statusType
} = require('../ci_utils');
const { CI_DOMAIN } = require('../ci_type_parser');

const resultName = (result) => {
  return result === null ? 'PENDING' : result.toUpperCase();
};

const getUrl = (path) => {
  const urlPath = path.replace(`https://${CI_DOMAIN}/`, '').replace('api/json', '');
  return `https://${CI_DOMAIN}/${urlPath}`;
};

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

  setDailyBuildData({ result, changeSet, timestamp, builtOn }) {
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
    if (this.result === statusType.SUCCESS) {
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

module.exports = { TestBuild };
