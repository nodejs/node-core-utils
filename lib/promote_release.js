'use strict';

const path = require('path');
const { promises: fs } = require('fs');
const semver = require('semver');

const { getMergedConfig } = require('./config');
const { runSync } = require('./run');
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
    const { version, prid, cli } = this;

    // In the promotion stage, we can pull most relevant data
    // from the release commit created in the preparation stage.
    await this.parseDataFromReleaseCommit();

    // Verify that PR is ready to promote.
    cli.startSpinner('Verifying PR promotion readiness');
    const {
      jenkinsReady,
      githubCIReady,
      isApproved
    } = await this.verifyPRAttributes();
    if (!jenkinsReady) {
      cli.stopSpinner(`Jenkins CI is failing for #${prid}`);
      const proceed = await cli.prompt('Do you want to proceed?');
      if (!proceed) {
        cli.warn(`Aborting release promotion for version ${version}`);
        return;
      }
    } else if (!githubCIReady) {
      cli.stopSpinner(`GitHub CI is failing for #${prid}`);
      const proceed = await cli.prompt('Do you want to proceed?');
      if (!proceed) {
        cli.warn(`Aborting release promotion for version ${version}`);
        return;
      }
    } else if (!isApproved) {
      cli.stopSpinner(`#${prid} does not have sufficient approvals`);
      const proceed = await cli.prompt('Do you want to proceed?');
      if (!proceed) {
        cli.warn(`Aborting release promotion for version ${version}`);
        return;
      }
    }
    cli.stopSpinner(`The release PR for ${version} is ready to promote!`);

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
    cli.startSpinner('Successfully set up for next release');

    const shouldMergeProposalBranch = await cli.prompt(
      'Merge proposal branch into staging branch?');
    if (!shouldMergeProposalBranch) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }

    // Merge vX.Y.Z-proposal into vX.x.
    cli.startSpinner('Merging proposal branch');
    await this.mergeProposalBranch();
    cli.startSpinner('Merged proposal branch');

    // Cherry pick release commit to master.
    const shouldCherryPick = await cli.prompt(
      'Cherry-pick release commit to master?', { defaultAnswer: true });
    if (!shouldCherryPick) {
      cli.warn(`Aborting release promotion for version ${version}`);
      return;
    }
    await this.cherryPickToMaster();

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
    this.promoteAndSignRelease(keyPath);

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
    const isApproved = checker.checkReviewsAndWait(false /* checkComments */);

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
    if (!/\d{4}-\d{2}-\d{2}/.match(components[0])) {
      cli.error(`Release commit contains invalid date: ${components[0]}`);
      return;
    }
    this.date = components[0];

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
    return runSync('git', ['rev-parse', `HEAD~${position}`]);
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

  secureTagRelease() {
    const { version, isLTS, ltsCodename } = this;

    const secureTag = path.join(
      __dirname,
      '../node_modules/.bin/git-secure-tag' + (isWindows ? '.cmd' : '')
    );

    const releaseInfo = isLTS ? `'${ltsCodename}' (LTS)` : '(Current)';
    const secureTagOptions = [
      `v${version}`,
      this.getCommitSha(),
      '-sm',
      `"${this.date} Node.js v${version} ${releaseInfo} Release"`
    ];

    return runSync(secureTag, secureTagOptions);
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
      `${versionComponents.major}.${versionComponents.minor}.${patchVersion}`;

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

  async mergeProposalBranch() {
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

  promoteAndSignRelease(keyPath) {
    return runSync('./tools/release.sh', ['-i', keyPath]);
  }

  async cherryPickToMaster() {
    // Since we've committed the Working On commit,
    // the release commit will be 1 removed from
    // tip-of-tree (e.g HEAD~1).
    const releaseCommitSha = this.getCommitSha(1);
    runSync('git', ['checkout', 'master']);

    // There will be conflicts.
    runSync('git', ['cherry-pick', releaseCommitSha]);
    // TODO(codebytere): gracefully handle conflicts and
    // wait for the releaser to resolve.
  }
}

module.exports = ReleasePromotion;
