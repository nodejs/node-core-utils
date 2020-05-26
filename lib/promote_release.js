'use strict';

const path = require('path');
const { promises: fs } = require('fs');
const semver = require('semver');

const { getMergedConfig } = require('./config');
const { runSync, runAsync } = require('./run');
const auth = require('./auth');
const PRData = require('./pr_data');
const PRChecker = require('./pr_checker');
const Request = require('./request');

const isWindows = process.platform === 'win32';

class ReleasePromotion {
  constructor(argv, cli, dir) {
    this.cli = cli;
    this.dir = dir;
    this.isLTS = false;
    this.prid = argv.prid;
    this.ltsCodename = '';
    this.date = '';
    this.config = getMergedConfig(this.dir);
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
    this.secureTagRelease();

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
    this.mergeProposalBranch();
    cli.stopSpinner('Merged proposal branch');

    // Cherry pick release commit to master.
    const shouldCherryPick = await cli.prompt(
      'Cherry-pick release commit to master?', { defaultAnswer: true });
    if (!shouldCherryPick) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }
    await this.cherryPickToMaster();

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
    this.pushReleaseTag();

    // Promote and sign the release builds.
    const shouldPromote = await cli.prompt('Promote and sign release builds?',
      { defaultAnswer: true });
    if (!shouldPromote) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }

    const defaultKeyPath = '~/.ssh/node_id_rsa';
    const keyPath = await cli.prompt(
      `Please enter the path to your ssh key (Default ${defaultKeyPath}): `,
      { questionType: 'input', defaultAnswer: defaultKeyPath });
    await this.promoteAndSignRelease(keyPath);

    cli.separator();
    cli.ok(`Release promotion for ${version} complete.\n`);
    cli.info(
      'To finish this release, you\'ll need to: \n' +
      ` 1) Check the release at: https://nodejs.org/dist/v${version}\n` +
      ' 2) Create the blog post for nodejs.org\n' +
      ' 3) Create the release on GitHub\n' +
      'Finally, proceed to Twitter and announce the new release!');
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

    const releaseCommitMessage = runSync(
      'git', ['log', '-n', '1', '--pretty=format:\'%s\'']).trim();

    const components = releaseCommitMessage.split(' ');

    // Parse out release date.
    const match = components[0].match(/\d{4}-\d{2}-\d{2}/);
    if (!match) {
      cli.error(`Release commit contains invalid date: ${components[0]}`);
      return;
    }
    this.date = match[0];

    // Parse out release version.
    const version = semver.clean(components[2]);
    if (!semver.valid(version)) {
      cli.error(`Release commit contains invalid semantic version: ${version}`);
      return;
    }

    this.version = version;
    this.stagingBranch = `v${semver.major(version)}.x-staging`;
    this.versionComponents = {
      major: semver.major(version),
      minor: semver.minor(version),
      patch: semver.patch(version)
    };

    // Parse out LTS status and codename.
    if (components.length === 5) {
      this.isLTS = true;
      this.ltsCodename = components[3];
    }
  }

  getCommitSha(position = 0) {
    return runSync('git', ['rev-parse', `HEAD~${position}`]).trim();
  }

  get owner() {
    return this.config.owner || 'nodejs';
  }

  get repo() {
    return this.config.repo || 'node';
  }

  get username() {
    return this.config.username;
  }

  async secureTagRelease() {
    const { version, isLTS, ltsCodename } = this;

    const secureTag = path.join(
      __dirname,
      '../node_modules/.bin/git-secure-tag' + (isWindows ? '.cmd' : '')
    );

    const releaseInfo = isLTS ? `${ltsCodename} (LTS)` : '(Current)';
    const secureTagOptions = [
      `v${version}`,
      this.getCommitSha(),
      '-sm',
      `${this.date} Node.js v${version} ${releaseInfo} Release`
    ];

    await runAsync(secureTag, secureTagOptions);
  }

  // Set up the branch so that nightly builds are produced with the next
  // version number and a pre-release tag.
  async setupForNextRelease() {
    const { versionComponents, prid } = this;

    // Update node_version.h for next patch release.
    const filePath = path.resolve('src', 'node_version.h');
    const data = await fs.readFile(filePath, 'utf8');
    const arr = data.split('\n');

    const patchVersion = versionComponents.patch + 1;
    arr.forEach((line, idx) => {
      if (line.includes('#define NODE_PATCH_VERSION')) {
        arr[idx] = `#define NODE_PATCH_VERSION ${patchVersion}`;
      } else if (line.includes('#define NODE_VERSION_IS_RELEASE')) {
        arr[idx] = '#define NODE_VERSION_IS_RELEASE 0';
      }
    });

    await fs.writeFile(filePath, arr.join('\n'));

    const workingOnVersion =
      `v${versionComponents.major}.${versionComponents.minor}.${patchVersion}`;

    // Create 'Working On' commit.
    runSync('git', ['add', filePath]);
    return runSync('git', [
      'commit',
      '-m',
      `Working on ${workingOnVersion}`,
      '-m',
      `PR-URL: https://github.com/nodejs/node/pull/${prid}`
    ]);
  }

  mergeProposalBranch() {
    const { stagingBranch, versionComponents, version } = this;

    const releaseBranch = `v${versionComponents.major}.x`;
    const proposalBranch = `v${version}-proposal`;

    runSync('git', ['checkout', releaseBranch]);
    runSync('git', ['merge', '--ff-only', proposalBranch]);
    runSync('git', ['push', 'upstream', releaseBranch]);
    runSync('git', ['checkout', stagingBranch]);
    runSync('git', ['rebase', releaseBranch]);
    runSync('git', ['push', 'upstream', stagingBranch]);
  }

  pushReleaseTag() {
    const { version } = this;

    const tagVersion = `v${version}`;
    return runSync('git', ['push', 'upstream', tagVersion]);
  }

  async promoteAndSignRelease(keyPath) {
    await runAsync('./tools/release.sh', ['-i', keyPath]);
  }

  async cherryPickToMaster() {
    // Since we've committed the Working On commit, the release
    // commit will be 1 removed from tip-of-tree (e.g HEAD~1).
    const releaseCommitSha = this.getCommitSha(1);
    runSync('git', ['checkout', 'master']);

    // Pull master from upstream, in case it's not up-to-date.
    runSync('git', ['pull', '--rebase', 'upstream', 'master']);

    // There will be conflicts.
    await runAsync('git', ['cherry-pick', releaseCommitSha]);
  }
}

module.exports = ReleasePromotion;
