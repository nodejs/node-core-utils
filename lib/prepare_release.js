'use strict';

const path = require('path');
const fs = require('fs').promises;
const semver = require('semver');
const replace = require('replace-in-file');

const { getMergedConfig } = require('./config');
const { runAsync, runSync } = require('./run');
const { writeJson, readJson } = require('./file');

const isWindows = process.platform === 'win32';

class ReleasePreparation {
  constructor(argv, cli, dir) {
    this.cli = cli;
    this.dir = dir;
    this.isSecurityRelease = argv.security;
    this.isLTS = false;
    this.ltsCodename = '';
    this.date = '';
    this.config = getMergedConfig(this.dir);

    // Allow passing optional new version.
    if (argv.newVersion) {
      const newVersion = semver.clean(argv.newVersion);
      if (!semver.valid(newVersion)) {
        cli.warn(`${newVersion} is not a valid semantic version.`);
        return;
      }
      this.newVersion = newVersion;
    } else {
      this.newVersion = this.calculateNewVersion();
    }

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

    // Check the branch diff to determine if the releaser
    // wants to backport any more commits before proceeding.
    cli.startSpinner('Fetching branch-diff');
    const raw = this.getBranchDiff({
      onlyNotableChanges: false,
      comparisonBranch: newVersion
    });

    const diff = raw.split('*');
    cli.stopSpinner('Got branch diff');

    const outstandingCommits = diff.length - 1;
    if (outstandingCommits !== 0) {
      const staging = `v${semver.major(newVersion)}.x-staging`;
      const proceed = await cli.prompt(
        `There are ${outstandingCommits} commits that may be ` +
        `backported to ${staging} - do you still want to proceed?`,
        { defaultAnswer: false });

      if (!proceed) {
        const seeDiff = await cli.prompt(
          'Do you want to see the branch diff?');
        if (seeDiff) cli.log(raw);
        return;
      }
    }

    // Create new proposal branch.
    cli.startSpinner(`Creating new proposal branch for ${newVersion}`);
    await this.createProposalBranch();
    cli.stopSpinner(`Created new proposal branch for ${newVersion}`);

    // Update version and release info in src/node_version.h.
    cli.startSpinner(`Updating 'src/node_version.h' for ${newVersion}`);
    await this.updateNodeVersion();
    cli.stopSpinner(`Updated 'src/node_version.h' for ${newVersion}`);

    // Check whether to update NODE_MODULE_VERSION.
    const isSemverMajor = versionComponents.minor === 0;
    if (isSemverMajor) {
      const shouldUpdateNodeModuleVersion = await cli.prompt(
        'Update NODE_MODULE_VERSION?', { defaultAnswer: false });
      if (shouldUpdateNodeModuleVersion) {
        const variant = await cli.prompt(
          'Specify variant (ex. \'v8_7.9\') for new NODE_MODULE_VERSION:',
          { questionType: 'input', noSeparator: true });
        const versions = await cli.prompt(
          'Specify versions (ex. \'14.0.0-pre\') for new NODE_MODULE_VERSION:',
          { questionType: 'input', noSeparator: true });
        this.updateNodeModuleVersion('node', variant, versions);
      }
    }

    // Update any REPLACEME tags in the docs.
    cli.startSpinner('Updating REPLACEME items in docs');
    await this.updateREPLACEMEs();
    cli.stopSpinner('Updated REPLACEME items in docs');

    // Fetch date to use in release commit & changelogs.
    this.date = await cli.prompt('Enter release date in YYYY-MM-DD format:',
      { questionType: 'input' });

    cli.startSpinner('Updating CHANGELOG.md');
    await this.updateMainChangelog();
    cli.stopSpinner('Updated CHANGELOG.md');

    cli.startSpinner(`Updating CHANGELOG_V${versionComponents.major}.md`);
    await this.updateMajorChangelog();
    cli.stopSpinner(`Updated CHANGELOG_V${versionComponents.major}.md`);

    await cli.prompt('Finished editing the changelogs?',
      { defaultAnswer: false });

    // Create release commit.
    const shouldCreateReleaseCommit = await cli.prompt(
      'Create release commit?');
    if (!shouldCreateReleaseCommit) {
      cli.warn(`Aborting \`git node release\` for version ${newVersion}`);
      return;
    }

    // Proceed with release only after the releaser has amended
    // it to their liking.
    const createDefaultCommit = await this.createReleaseCommit();
    if (!createDefaultCommit) {
      const lastCommitSha = runSync('git', ['rev-parse', '--short', 'HEAD']);
      cli.warn(`Please manually edit commit ${lastCommitSha} by running ` +
      '`git commit --amend` before proceeding.');

      await cli.prompt(
        'Finished editing the release commit?',
        { defaultAnswer: false });
    }

    cli.separator();
    cli.ok(`Release preparation for ${newVersion} complete.\n`);
    cli.info(
      'To finish the release proposal, run: \n' +
      `      $ git push -u ${this.upstream} v${newVersion}-proposal\n` +
      'Finally, proceed to Jenkins and begin the following CI jobs:\n' +
      '      * https://ci.nodejs.org/job/node-test-pull-request/\n' +
      '      * https://ci.nodejs.org/job/citgm-smoker/');
    cli.info(
      'If this release has deps/v8 changes, you\'ll also need to run:\n' +
      '      * https://ci.nodejs.org/job/node-test-commit-v8-linux/'
    );
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

  calculateNewVersion() {
    let newVersion;

    const lastTagVersion = semver.clean(this.getLastRef());
    const lastTag = {
      major: semver.major(lastTagVersion),
      minor: semver.minor(lastTagVersion),
      patch: semver.patch(lastTagVersion)
    };

    const changelog = this.getChangelog();

    if (changelog.includes('SEMVER-MAJOR')) {
      newVersion = `${lastTag.major + 1}.0.0`;
    } else if (changelog.includes('SEMVER-MINOR')) {
      newVersion = `${lastTag.major}.${lastTag.minor + 1}.0`;
    } else {
      newVersion = `${lastTag.major}.${lastTag.minor}.${lastTag.patch + 1}`;
    }

    return newVersion;
  }

  getCurrentBranch() {
    return runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  }

  getLastRef() {
    return runSync('git', ['describe', '--abbrev=0', '--tags']).trim();
  }

  getChangelog() {
    const changelogMaker = path.join(
      __dirname,
      '../node_modules/.bin/changelog-maker' + (isWindows ? '.cmd' : '')
    );

    return runSync(changelogMaker, [
      '--group',
      '--filter-release',
      '--start-ref',
      this.getLastRef()
    ]).trim();
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
    const allCommits = this.getChangelog();
    const notableChanges = this.getBranchDiff({ onlyNotableChanges: true });
    const releaseHeader = `## ${date}, Version ${newVersion}` +
                          ` ${releaseInfo}, @${username}\n`;

    const topHeader =
      `<a href="#${lastRef.substring(1)}">${lastRef.substring(1)}</a><br/>`;
    const newHeader =
      `<a href="#${newVersion}">${newVersion}</a><br/>`;
    for (let idx = 0; idx < arr.length; idx++) {
      if (arr[idx].includes(topHeader)) {
        arr.splice(idx, 0, newHeader);
        idx++;
      } else if (arr[idx].includes(`<a id="${lastRef.substring(1)}"></a>`)) {
        const toAppend = [];
        toAppend.push(`<a id="${newVersion}"></a>`);
        toAppend.push(releaseHeader);
        toAppend.push('### Notable Changes\n');
        toAppend.push(notableChanges);
        toAppend.push('### Commits\n');
        toAppend.push(allCommits);
        toAppend.push('');

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
        this.isLTS = arr[idx].split(' ')[2] === '1';
        this.ltsCodename = arr[idx + 1].split(' ')[2].slice(1, -1);
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
    const {
      cli,
      isLTS,
      ltsCodename,
      newVersion,
      isSecurityRelease,
      date
    } = this;

    const releaseInfo = isLTS ? `'${ltsCodename}' (LTS)` : '(Current)';
    const messageTitle = `${date}, Version ${newVersion} ${releaseInfo}`;

    const messageBody = [];
    if (isSecurityRelease) {
      messageBody.push('This is a security release.\n\n');
    }

    const notableChanges = this.getBranchDiff({
      onlyNotableChanges: true,
      simple: true
    });
    messageBody.push('Notable changes:\n\n');
    messageBody.push(notableChanges);
    messageBody.push('\nPR-URL: TODO');

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
    const useMessage = await cli.prompt(
      'Continue with this commit message?', { defaultAnswer: false });
    return useMessage;
  }

  getBranchDiff(opts) {
    const {
      versionComponents = {},
      upstream,
      newVersion,
      isLTS
    } = this;

    let majorVersion;
    let stagingBranch;
    if (Object.keys(versionComponents).length !== 0) {
      majorVersion = versionComponents.major;
      stagingBranch = this.stagingBranch;
    } else {
      stagingBranch = this.getCurrentBranch();
      const stagingBranchSemver = semver.coerce(stagingBranch);
      majorVersion = stagingBranchSemver.major;
    }

    let branchDiffOptions;
    if (opts.onlyNotableChanges) {
      const proposalBranch = `v${newVersion}-proposal`;
      const releaseBranch = `v${majorVersion}.x`;

      const notableLabels = [
        'notable-change',
        'semver-minor'
      ];

      branchDiffOptions = [
        `${upstream}/${releaseBranch}`,
        proposalBranch,
        `--require-label=${notableLabels.join(',')}`
      ];

      if (opts.simple) {
        branchDiffOptions.push('--simple');
      }
    } else {
      const excludeLabels = [
        'semver-major',
        `dont-land-on-v${majorVersion}.x`,
        `backport-requested-v${majorVersion}.x`,
        `backported-to-v${majorVersion}.x`,
        `backport-blocked-v${majorVersion}.x`
      ];

      let comparisonBranch = 'master';
      const isSemverMinor = versionComponents.patch === 0;
      if (isLTS) {
        // Assume Current branch matches tag with highest semver value.
        const tags = runSync('git',
          ['tag', '-l', '--sort', '-version:refname']).trim();
        const highestVersionTag = tags.split('\n')[0];
        comparisonBranch = `v${semver.coerce(highestVersionTag).major}.x`;

        if (!isSemverMinor) {
          excludeLabels.push('semver-minor');
        }
      }

      branchDiffOptions = [
        stagingBranch,
        comparisonBranch,
        `--exclude-label=${excludeLabels.join(',')}`,
        '--filter-release'
      ];
    }

    const branchDiff = path.join(
      __dirname,
      '../node_modules/.bin/branch-diff' + (isWindows ? '.cmd' : '')
    );

    return runSync(branchDiff, branchDiffOptions);
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

module.exports = ReleasePreparation;
