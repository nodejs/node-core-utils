import { statusType } from '../ci_utils.js';
import { flatten } from '../../utils.js';
import { FANNED_TREE } from '../jenkins_constants.js';
import CIFailureParser from '../ci_failure_parser.js';
import { Job } from './job.js';
import { NormalBuild } from './normal_build.js';

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
  }
} = CIFailureParser;

export class FannedBuild extends Job {
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
