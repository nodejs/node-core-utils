import { PR_TREE } from '../jenkins_constants.js';
import CIFailureParser from '../ci_failure_parser.js';
import { TestBuild } from './test_build.js';
import { CommitBuild } from './commit_build.js';

const {
  FAILURE_TYPES: {
    BUILD_FAILURE,
    NCU_FAILURE
  },
  FAILURE_CONSTRUCTORS: {
    [BUILD_FAILURE]: BuildFailure,
    [NCU_FAILURE]: NCUFailure
  }
} = CIFailureParser;

export class PRBuild extends TestBuild {
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
