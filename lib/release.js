'use strict';

const path = require('path');
const fs = require('fs').promises;
const semver = require('semver');
const replace = require('replace-in-file');

const { getMergedConfig } = require('./config');
const { runAsync, runSync } = require('./run');
const { writeJson, readJson } = require('./file');

class Release {
  constructor(state, argv, cli, req, dir) {
    this.cli = cli;
    this.dir = dir;
    this.newVersion = argv.newVersion;
    this.isSecurityRelease = argv.security;
    this.isLTS = false;
    this.ltsCodename = '';
    this.date = '';
    this.config = getMergedConfig(this.dir);

    const { upstream, owner, repo, newVersion } = this;

    this.versionComponents = {
      major: semver.major(newVersion),
      minor: semver.minor(newVersion),
      patch: semver.patch(newVersion)
    };

    this.stagingBranch = `v${this.versionComponents.major}.x-staging`;

    const upstreamHref = runSync('git', [
      'config', '--get',
      `remote.${upstream}.url`]).trim();
    if (!new RegExp(`${owner}/${repo}(?:.git)?$`).test(upstreamHref)) {
      cli.warn('Remote repository URL does not point to the expected ' +
        `repository ${owner}/${repo}`);
    }
  }

  async prepare() {
    const { cli, newVersion, versionComponents } = this;

    // Create new proposal branch.
    const shouldBranch = await cli.prompt(
      `Create new proposal branch for ${newVersion}?`, true);
    if (!shouldBranch) return this.abort();
    await this.createProposalBranch();

    // Update version and release info in src/node_version.h.
    const shouldUpdateNodeVersion = await cli.prompt(
      `Update 'src/node_version.h' for ${newVersion}?`, true);
    if (!shouldUpdateNodeVersion) return this.abort();
    await this.updateNodeVersion();

    // Check whether to update NODE_MODULE_VERSION (default false).
    const shouldUpdateNodeModuleVersion = await cli.prompt(
      'Update NODE_MODULE_VERSION?', false);
    if (shouldUpdateNodeModuleVersion) {
      const runtime = await cli.promptInput(
        'Specify runtime (ex. \'node\') for new NODE_MODULE_VERSION:',
        false);
      const variant = await cli.promptInput(
        'Specify variant (ex. \'v8_7.9\') for new NODE_MODULE_VERSION:',
        false);
      const versions = await cli.promptInput(
        'Specify versions (ex. \'14.0.0-pre\') for new NODE_MODULE_VERSION:',
        false);
      this.updateNodeModuleVersion(runtime, variant, versions);
    }

    // Update any REPLACEME tags in the docs.
    const shouldUpdateREPLACEMEs = await cli.prompt(
      'Update REPLACEME items in docs?', true);
    if (!shouldUpdateREPLACEMEs) return this.abort();
    await this.updateREPLACEMEs();

    this.date = await cli.promptInput(
      'Enter release date in YYYY-MM-DD format:');

    // Update Changelogs
    const shouldUpdateChangelogs = await cli.prompt(
      'Update changelogs?', true);
    if (!shouldUpdateChangelogs) return this.abort();

    cli.startSpinner('Updating CHANGELOG.md');
    await this.updateMainChangelog();
    cli.stopSpinner('Updated CHANGELOG.md');

    cli.startSpinner(`Updating CHANGELOG_V${versionComponents.major}.md`);
    await this.updateMajorChangelog();
    cli.stopSpinner(`Updated CHANGELOG_V${versionComponents.major}.md`);

    await cli.prompt('Finished editing the changelogs?', false);

    // Create release commit.
    const shouldCreateReleaseCommit = await cli.prompt(
      'Create release commit?', true);
    if (!shouldCreateReleaseCommit) return this.abort();

    // Proceed with release only after the releaser has amended
    // it to their liking.
    const created = await this.createReleaseCommit();
    if (!created) {
      const lastCommitSha = runSync('git', ['rev-parse', '--short', 'HEAD']);
      cli.warn(`Please manually edit commit ${lastCommitSha} by running ` +
      '`git commit --amend` before proceeding.');

      await cli.prompt(
        'Type y when you have finished editing the release commit:',
        false);
    }

    // Open pull request against the release branch.
    const shouldOpenPR = await cli.prompt(
      'Push branch and open pull request?', true);
    if (!shouldOpenPR) return this.abort();
    this.openPullRequest();

    cli.separator();
    cli.ok(`Release preparation for ${newVersion} complete.\n`);
    cli.info(
      'Please proceed to Jenkins and begin the following CI jobs:\n' +
      '      * https://ci.nodejs.org/job/node-test-pull-request/\n' +
      '      * https://ci.nodejs.org/job/citgm-smoker/');
    cli.info(
      'If this release deps/v8 changes, you\'ll also need to run:\n' +
      '      * https://ci.nodejs.org/job/node-test-commit-v8-linux/'
    );
  }

  async promote() {
    // TODO(codebytere): implement.
  }

  get owner() {
    return this.config.owner || 'nodejs';
  }

  get repo() {
    return this.config.repo || 'node';
  }

  get upstream() {
    return this.config.upstream;
  }

  get username() {
    return this.config.username;
  }

  async abort() {
    const { cli, newVersion } = this;

    // TODO(codebytere): figure out what kind of cleanup we want to do here.

    cli.ok(`Aborted \`git node release\` for version ${newVersion}`);
  }

  getCurrentBranch() {
    return runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  }

  getLastRef() {
    return runSync('git', ['describe', '--abbrev=0', '--tags']).trim();
  }

  getChangelog() {
    return runSync('npx', [
      'changelog-maker',
      '--group',
      '--start-ref',
      this.getLastRef()
    ]).trim();
  }

  openPullRequest() {
    const { newVersion, upstream, cli, versionComponents } = this;
    const proposalBranch = `v${newVersion}-proposal`;
    const releaseBranch = `v${versionComponents.major}.x`;

    const pushed = runSync('git', ['push', upstream, proposalBranch]).trim();

    if (pushed) {
      runSync('open',
        [`https://github.com/nodejs/node/compare/${releaseBranch}...${proposalBranch}?expand=1`]);
    } else {
      cli.warn(`Failed to push ${proposalBranch} to ${upstream}.`);
    }
  }

  async updateREPLACEMEs() {
    const { newVersion } = this;

    await replace({
      files: 'doc/api/*.md',
      from: /REPLACEME/g,
      to: `v${newVersion}`
    });
  }

  async updateMainChangelog() {
    const { versionComponents, newVersion } = this;

    // Remove the leading 'v'.
    const lastRef = this.getLastRef().substring(1);

    const mainChangelogPath = path.resolve('CHANGELOG.md');
    const data = await fs.readFile(mainChangelogPath, 'utf8');
    const arr = data.split('\n');

    const hrefLink = `doc/changelogs/CHANGELOG_V${versionComponents.major}.md`;
    const newRefLink = `<a href="${hrefLink}#${newVersion}">${newVersion}</a>`;
    const lastRefLink = `<a href="${hrefLink}#${lastRef}">${lastRef}</a>`;

    for (let idx = 0; idx < arr.length; idx++) {
      if (arr[idx].includes(`<b>${lastRefLink}</b><br/>`)) {
        arr.splice(idx, 1, `<b>${newRefLink}</b><br/>`, `${lastRefLink}<br/>`);
        break;
      }
    };

    await fs.writeFile(mainChangelogPath, arr.join('\n'));
  }

  async updateMajorChangelog() {
    const {
      versionComponents,
      newVersion,
      date,
      isLTS,
      ltsCodename,
      username
    } = this;

    const releaseInfo = isLTS ? `'${ltsCodename}' (LTS)` : '(Current)';
    const lastRef = this.getLastRef();
    const majorChangelogPath = path.resolve(
      'doc',
      'changelogs',
      `CHANGELOG_V${versionComponents.major}.md`
    );

    const data = await fs.readFile(majorChangelogPath, 'utf8');
    const arr = data.split('\n');

    const allCommits = runSync('npx', [
      'changelog-maker',
      '--group',
      '--filter-release',
      '--start-ref',
      lastRef
    ]);

    const notableChanges = this.checkBranchDiff(true);
    const releaseHeader = `## ${date}, Version ${newVersion}` +
                          ` ${releaseInfo}, @${username}\n`;

    for (let idx = 0; idx < arr.length; idx++) {
      if (arr[idx].includes(`<a id="${lastRef.substring(1)}"></a>`)) {
        const toAppend = [];
        toAppend.push(`<a id="${newVersion}"></a>`);
        toAppend.push(releaseHeader);
        toAppend.push('### Notable Changes\n');
        toAppend.push(notableChanges);
        toAppend.push('### Commits\n');
        toAppend.push(allCommits);

        arr.splice(idx, 0, ...toAppend);
        break;
      }
    };

    await fs.writeFile(majorChangelogPath, arr.join('\n'));
  }

  async createProposalBranch() {
    const { upstream, newVersion, stagingBranch } = this;
    const proposalBranch = `v${newVersion}-proposal`;

    await runAsync('git', [
      'checkout',
      '-b',
      proposalBranch,
      `${upstream}/${stagingBranch}`
    ]);
  }

  async updateNodeVersion() {
    const { versionComponents } = this;

    const filePath = path.resolve('src', 'node_version.h');
    const data = await fs.readFile(filePath, 'utf8');
    const arr = data.split('\n');

    arr.forEach((line, idx) => {
      if (line.includes('#define NODE_MAJOR_VERSION')) {
        arr[idx] = `#define NODE_MAJOR_VERSION ${versionComponents.major}`;
      } else if (line.includes('#define NODE_MINOR_VERSION')) {
        arr[idx] = `#define NODE_MINOR_VERSION ${versionComponents.minor}`;
      } else if (line.includes('#define NODE_PATCH_VERSION')) {
        arr[idx] = `#define NODE_PATCH_VERSION ${versionComponents.patch}`;
      } else if (line.includes('#define NODE_VERSION_IS_RELEASE')) {
        arr[idx] = '#define NODE_VERSION_IS_RELEASE 1';
      } else if (line.includes('#define NODE_VERSION_IS_LTS')) {
        this.isLTS = arr[idx].split(' ')[2] === 1;
        this.ltsCodename = arr[idx + 1].split(' ')[2];
      }
    });

    await fs.writeFile(filePath, arr.join('\n'));
  }

  updateNodeModuleVersion(runtime, variant, versions) {
    const nmvFilePath = path.resolve('doc', 'abi_version_registry.json');
    const nmvArray = readJson(nmvFilePath).NODE_MODULE_VERSION;

    const latestNMV = nmvArray[0];
    const modules = latestNMV.modules + 1;
    nmvArray.unshift({ modules, runtime, variant, versions });

    writeJson(nmvFilePath, { NODE_MODULE_VERSION: nmvArray });
  }

  async createReleaseCommit() {
    const { cli, isLTS, newVersion, isSecurityRelease, date } = this;

    const releaseType = isLTS ? 'LTS' : 'Current';
    const messageTitle = `${date} Version ${newVersion} (${releaseType})`;

    const messageBody = [];
    if (isSecurityRelease) {
      messageBody.push('This is a security release.\n\n');
    }

    messageBody.push('Notable changes:\n\n');

    // TODO(codebytere): add notable changes formatted for plaintext.

    // Create commit and then allow releaser to amend.
    runSync('git', ['add', '.']);
    runSync('git', [
      'commit',
      '-m',
      messageTitle,
      '-m',
      messageBody.join('')
    ]);

    cli.log(`${messageTitle}\n\n${messageBody.join('')}`);
    const useMessage = await cli.prompt('Continue with this commit message?');
    return useMessage;
  }

  checkBranchDiff(onlyNotableChanges = false) {
    const { versionComponents, stagingBranch, upstream, newVersion } = this;

    let branchDiffOptions;
    if (onlyNotableChanges) {
      const proposalBranch = `v${newVersion}-proposal`;
      const releaseBranch = `v${versionComponents.major}.x`;

      branchDiffOptions = [
        'branch-diff',
        `${upstream}/${releaseBranch}`,
        proposalBranch,
        '--require-label=notable-change',
        '-format=simple'
      ];
    } else {
      const excludeLabels = [
        'semver-major',
        `dont-land-on-v${versionComponents.major}.x`,
        `backport-requested-v${versionComponents.major}.x`
      ];

      if (versionComponents.patch !== 0) {
        excludeLabels.push('semver-minor');
      }

      branchDiffOptions = [
        'branch-diff',
        stagingBranch,
        'master',
        `--exclude-label=${excludeLabels.join(',')}`,
        '--filter-release',
        '--format=simple'
      ];
    }

    return runSync('npx', branchDiffOptions);
  }

  warnForWrongBranch() {
    const { cli, stagingBranch, versionComponents } = this;
    const rev = this.getCurrentBranch();

    if (rev === stagingBranch) {
      return false;
    }

    if (rev === 'HEAD') {
      cli.warn(
        'You are in detached HEAD state. Please run git-node on a valid ' +
        'branch');
      return true;
    }

    cli.warn(
      'You are trying to create a new release proposal branch for ' +
      `v${versionComponents.major}, but you're checked out on ` +
      `${rev} and not ${stagingBranch}.`);
    cli.separator();
    cli.info(
      `Switch to \`${stagingBranch}\` with \`git` +
      `checkout ${stagingBranch}\` before proceeding.`);
    cli.separator();
    return true;
  }
}

module.exports = Release;
