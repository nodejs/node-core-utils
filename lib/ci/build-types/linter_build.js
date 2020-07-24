'use strict';

const { Job } = require('./job');
const { LINTER_TREE } = require('../jenkins_constants');
const {
  FAILURE_TYPES: { NCU_FAILURE },
  FAILURE_CONSTRUCTORS: {
    [NCU_FAILURE]: NCUFailure
  }
} = require('../ci_failure_parser');

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

module.exports = { LinterBuild };
