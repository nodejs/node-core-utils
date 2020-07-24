'use strict';

const { Job } = require('./job');
const { TestRun } = require('./test_run');
const { statusType } = require('../ci_utils');
const { flatten } = require('../../utils');
const { BUILD_TREE } = require('../jenkins_constants');
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

module.exports = { NormalBuild };
