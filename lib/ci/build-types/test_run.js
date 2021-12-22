import { RUN_TREE } from '../jenkins_constants.js';
import { getPath } from '../ci_utils.js';
import CIFailureParser from '../ci_failure_parser.js';
import { Job } from './job.js';

const {
  FAILURE_TYPES: { NCU_FAILURE },
  FAILURE_CONSTRUCTORS: {
    [NCU_FAILURE]: NCUFailure
  }
} = CIFailureParser;

export class TestRun extends Job {
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
