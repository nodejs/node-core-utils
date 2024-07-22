import { LINTER_TREE } from '../jenkins_constants.js';
import CIFailureParser from '../ci_failure_parser.js';
import { Job } from './job.js';

const {
  FAILURE_TYPES: { NCU_FAILURE },
  FAILURE_CONSTRUCTORS: {
    [NCU_FAILURE]: NCUFailure
  }
} = CIFailureParser;

export class LinterBuild extends Job {
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
