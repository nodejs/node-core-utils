'use strict';

const { Job } = require('./job');
const { RUN_TREE } = require('../jenkins_constants');
const { getPath } = require('../ci_utils');
const {
  FAILURE_TYPES: { NCU_FAILURE },
  FAILURE_CONSTRUCTORS: {
    [NCU_FAILURE]: NCUFailure
  }
} = require('../ci_failure_parser');

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

module.exports = { TestRun };
