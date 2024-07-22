import path from 'node:path';
import fs from 'node:fs/promises';
import semver from 'semver';
import * as gst from 'git-secure-tag';

import { forceRunAsync } from './run.js';
import auth from './auth.js';
import PRData from './pr_data.js';
import PRChecker from './pr_checker.js';
import Request from './request.js';
import Session from './session.js';

export default class ReleasePromotion extends Session {
  constructor(argv, cli, dir) {
    super(cli, dir, argv.prid);
    this.isLTS = false;
    this.ltsCodename = '';
    this.date = '';
  }

  async promote() {
    // In the promotion stage, we can pull most relevant data
    // from the release commit created in the preparation stage.
    await this.parseDataFromReleaseCommit();

    const { prid, cli, version } = this;

    // Verify that PR is ready to promote.
    const {
      jenkinsReady,
      githubCIReady,
      isApproved
    } = await this.verifyPRAttributes();

    cli.startSpinner('Verifying Jenkins CI status');
    if (!jenkinsReady) {
      cli.stopSpinner(
        `Jenkins CI is failing for #${prid}`, cli.SPINNER_STATUS.FAILED);
      const proceed = await cli.prompt('Do you want to proceed?');
      if (!proceed) {
        cli.warn(`Aborting release promotion for version ${version}`);
        return;
      }
    } else {
      cli.stopSpinner('Jenkins CI is passing');
    }

    cli.startSpinner('Verifying GitHub CI status');
    if (!githubCIReady) {
      cli.stopSpinner(
        `GitHub CI is failing for #${prid}`, cli.SPINNER_STATUS.FAILED);
      const proceed = await cli.prompt('Do you want to proceed?');
      if (!proceed) {
        cli.warn(`Aborting release promotion for version ${version}`);
        return;
      }
    } else {
      cli.stopSpinner('GitHub CI is passing');
    }

    cli.startSpinner('Verifying PR approval status');
    if (!isApproved) {
      cli.stopSpinner(
        `#${prid} does not have sufficient approvals`,
        cli.SPINNER_STATUS.FAILED);
      const proceed = await cli.prompt('Do you want to proceed?');
      if (!proceed) {
        cli.warn(`Aborting release promotion for version ${version}`);
        return;
      }
    } else {
      cli.stopSpinner(`#${prid} has necessary approvals`);
    }

    // Create and sign the release tag.
    const shouldTagAndSignRelease = await cli.prompt(
      'Tag and sign the release?');
    if (!shouldTagAndSignRelease) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }
    await this.secureTagRelease();

    // Set up for next release.
    cli.startSpinner('Setting up for next release');
    await this.setupForNextRelease();
    cli.stopSpinner('Successfully set up for next release');

    const shouldMergeProposalBranch = await cli.prompt(
      'Merge proposal branch into staging branch?');
    if (!shouldMergeProposalBranch) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }

    // Merge vX.Y.Z-proposal into vX.x.
    cli.startSpinner('Merging proposal branch');
    await this.mergeProposalBranch();
    cli.stopSpinner('Merged proposal branch');

    // Cherry pick release commit to master.
    const shouldCherryPick = await cli.prompt(
      'Cherry-pick release commit to the default branch?', { defaultAnswer: true });
    if (!shouldCherryPick) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }
    await this.cherryPickToDefaultBranch();

    // There will be cherry-pick conflicts the Releaser will
    // need to resolve, so confirm they've been resolved before
    // proceeding with next steps.
    cli.separator();
    cli.info(`After cherry-picking:
      * The version macros in src/node_version.h should contain whatever values
      were previously on master.
      * NODE_VERSION_IS_RELEASE should be 0.
    `);
    cli.separator();
    const didResolveConflicts = await cli.prompt(
      'Finished resolving cherry-pick conflicts?', { defaultAnswer: true });
    if (!didResolveConflicts) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }

    // Push release tag.
    const shouldPushTag = await cli.prompt('Push release tag?',
      { defaultAnswer: true });
    if (!shouldPushTag) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }
    await this.pushReleaseTag();

    // Promote and sign the release builds.
    const shouldPromote = await cli.prompt('Promote and sign release builds?',
      { defaultAnswer: true });
    if (!shouldPromote) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }

    // TODO: move this to .ncurc
    const defaultKeyPath = '~/.ssh/node_id_rsa';
    const keyPath = await cli.prompt(
      `Please enter the path to your ssh key (Default ${defaultKeyPath}): `,
      { questionType: 'input', defaultAnswer: defaultKeyPath });
    await this.promoteAndSignRelease(keyPath);

    cli.separator();
    cli.ok(`Release promotion for ${version} complete.\n`);
    cli.info(
      'To finish this release, you\'ll need to: \n' +
      ` 1. Check the release at: https://nodejs.org/dist/v${version}\n` +
      ' 2. Create the blog post for nodejs.org.\n' +
      ' 3. Create the release on GitHub.\n' +
      ' 4. Optionally, announce the release on your social networks.\n' +
      ' 5. Tag @nodejs-social-team on #nodejs-release Slack channel.\n');
  }

  async verifyPRAttributes() {
    const { cli, prid, owner, repo } = this;

    const credentials = await auth({ github: true });
    const request = new Request(credentials);

    const data = new PRData({ prid, owner, repo }, cli, request);
    await data.getAll();

    const checker = new PRChecker(cli, data, { prid, owner, repo });
    const jenkinsReady = checker.checkJenkinsCI();
    const githubCIReady = checker.checkGitHubCI();
    const isApproved = checker.checkReviewsAndWait(new Date(), false);

    return {
      jenkinsReady,
      githubCIReady,
      isApproved
    };
  }

  async parseDataFromReleaseCommit() {
    const { cli } = this;

    const data = await forceRunAsync('git', ['log', '-1', '--pretty=format:%H+%s']);
    this.releaseCommitSha = data.slice(0, 40);
    const releaseCommitMessage = data.slice(41);

    // Parse out release date.
    if (!/^\d{4}-\d{2}-\d{2}, Version \d/.test(releaseCommitMessage)) {
      cli.error(`Invalid Release commit message: ${releaseCommitMessage}`);
      return;
    }
    this.date = releaseCommitMessage.slice(0, 10);
    if (this.date !== new Date().toISOString().slice(0, 10)) {
      cli.warn('The release date does not match the system date for today.');
      await cli.prompt('Do you want to proceed?', { defaultAnswer: false });
    }

    // Parse out release version.
    const versionString = releaseCommitMessage.slice(20, releaseCommitMessage.indexOf(' ', 20));
    const version = semver.parse(versionString);
    if (!version) {
      cli.error(`Release commit contains invalid semantic version: ${versionString}`);
      return;
    }

    const { major, minor, patch } = version;
    this.stagingBranch = `v${major}.x-staging`;
    this.versionComponents = {
      major,
      minor,
      patch
    };

    // Parse out LTS status and codename.
    if (!releaseCommitMessage.endsWith(' (Current)')) {
      const match = /'([^']+)' \(LTS\)$/.exec(releaseCommitMessage);
      if (match == null) {
        cli.error('Invalid release commit, it should match either Current or LTS release format');
        return;
      }
      this.isLTS = true;
      this.ltsCodename = match[1];
    }
  }

  async secureTagRelease() {
    const { version, isLTS, ltsCodename } = this;

    const releaseInfo = isLTS ? `${ltsCodename} (LTS)` : '(Current)';

    await new Promise((resolve, reject) => {
      const api = new gst.API(process.cwd());
      api.sign(`v${version}`, this.releaseCommitSha, {
        insecure: false,
        m: `${this.date} Node.js v${version} ${releaseInfo} Release`
      }, (err) => err ? reject(err) : resolve());
    });
  }

  // Set up the branch so that nightly builds are produced with the next
  // version number and a pre-release tag.
  async setupForNextRelease() {
    const { versionComponents, prid } = this;

    // Update node_version.h for next patch release.
    const filePath = path.resolve('src', 'node_version.h');
    const nodeVersionFile = await fs.open(filePath, 'r+');

    const patchVersion = versionComponents.patch + 1;
    let cursor = 0;
    for await (const line of nodeVersionFile.readLines()) {
      cursor += line.length + 1;
      if (line === `#define NODE_PATCH_VERSION ${versionComponents.patch}`) {
        await nodeVersionFile.write(`${patchVersion}`, cursor - 1, 'ascii');
      } else if (line === '#define NODE_VERSION_IS_RELEASE 1') {
        await nodeVersionFile.write('0', cursor - 1, 'ascii');
        break;
      }
    }

    await nodeVersionFile.close();

    const workingOnVersion =
      `v${versionComponents.major}.${versionComponents.minor}.${patchVersion}`;

    // Create 'Working On' commit.
    await forceRunAsync('git', ['add', filePath]);
    return forceRunAsync('git', [
      'commit',
      '-m',
      `Working on ${workingOnVersion}`,
      '-m',
      `PR-URL: https://github.com/nodejs/node/pull/${prid}`
    ]);
  }

  mergeProposalBranch() {
    const { stagingBranch, versionComponents } = this;

    const releaseBranch = `v${versionComponents.major}.x`;

    return Promise.all([
      forceRunAsync('git', ['push', this.upstream, `HEAD:${releaseBranch}`]),
      forceRunAsync('git', ['push', this.upstream, `HEAD:${stagingBranch}`])
    ]);
  }

  pushReleaseTag() {
    const { version } = this;

    const tagVersion = `v${version}`;
    return forceRunAsync('git', ['push', this.upstream, tagVersion]);
  }

  async promoteAndSignRelease(keyPath) {
    await forceRunAsync('./tools/release.sh', ['-i', keyPath]);
  }

  async cherryPickToDefaultBranch() {
    const releaseCommitSha = this.releaseCommitSha;
    await forceRunAsync('git', ['checkout', 'main']);

    // Pull master from upstream, in case it's not up-to-date.
    await forceRunAsync('git', ['pull', '--rebase', this.upstream, 'main']);

    // There will be conflicts.
    // TODO: auto-fix obvious conflicts and/or ensure they are correctly fixed.
    await forceRunAsync('git', ['cherry-pick', releaseCommitSha]);
  }
}
