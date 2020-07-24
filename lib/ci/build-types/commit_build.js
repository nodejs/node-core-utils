'use strict';

const { TestBuild } = require('./test_build');
const { FannedBuild } = require('./fanned_build');
const { LinterBuild } = require('./linter_build');
const { NormalBuild } = require('./normal_build');
const { TestRun } = require('./test_run');
const { flatten } = require('../../utils');
const { statusType } = require('../ci_utils');
const { COMMIT_TREE } = require('../jenkins_constants');
const {
  FAILURE_TYPES: {
    BUILD_FAILURE,
    NCU_FAILURE
  },
  FAILURE_CONSTRUCTORS: {
    [BUILD_FAILURE]: BuildFailure,
    [NCU_FAILURE]: NCUFailure
  }
} = require('../ci_failure_parser');

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

module.exports = { CommitBuild };
