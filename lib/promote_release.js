import path from 'node:path';
import fs from 'node:fs/promises';
import semver from 'semver';
import * as gst from 'git-secure-tag';

import { forceRunAsync } from './run.js';
import PRData from './pr_data.js';
import PRChecker from './pr_checker.js';
import Session from './session.js';
import { existsSync } from 'node:fs';

const dryRunMessage = 'You are running in dry-run mode, meaning NCU will not run ' +
                      'the `git push` commands, you would need to copy-paste the ' +
                      'following command in another terminal window. Alternatively, ' +
                      'pass `--run` flag to ask NCU to run the command for you ' +
                      '(might not work if you need to type a passphrase to push to the remote).';

export default class ReleasePromotion extends Session {
  constructor(argv, req, cli, dir) {
    super(cli, dir, argv.prid);
    this.req = req;
    this.dryRun = !argv.run;
    this.isLTS = false;
    this.ltsCodename = '';
    this.date = '';
    this.gpgSign = argv?.['gpg-sign']
      ? (argv['gpg-sign'] === true ? ['-S'] : ['-S', argv['gpg-sign']])
      : [];
  }

  get branch() {
    return this.defaultBranch ?? this.config.branch;
  }

  async getDefaultBranch() {
    const { repository: { defaultBranchRef } } = await this.req.gql(
      'DefaultBranchRef',
      { owner: this.owner, repo: this.repo });
    return defaultBranchRef.name;
  }

  async promote() {
    const { prid, cli } = this;

    // In the promotion stage, we can pull most relevant data
    // from the release commit created in the preparation stage.
    // Verify that PR is ready to promote.
    const {
      githubCIReady,
      isApproved,
      jenkinsReady,
      releaseCommitSha
    } = await this.verifyPRAttributes();

    this.releaseCommitSha = releaseCommitSha;

    let localCloneIsClean = true;
    const currentHEAD = await forceRunAsync('git', ['rev-parse', 'HEAD'],
      { captureStdout: true, ignoreFailure: false });
    if (currentHEAD.trim() !== releaseCommitSha) {
      cli.warn('Current HEAD is not the release commit');
      localCloneIsClean = false;
    }
    try {
      await forceRunAsync('git', ['--no-pager', 'diff', '--exit-code'], { ignoreFailure: false });
    } catch {
      cli.warn('Some local changes have not been committed');
      localCloneIsClean = false;
    }
    if (!localCloneIsClean) {
      if (await cli.prompt('Should we reset the local HEAD to be the release proposal?')) {
        cli.startSpinner('Fetching the proposal upstream...');
        await forceRunAsync('git', ['fetch', this.upstream, releaseCommitSha],
          { ignoreFailure: false });
        await forceRunAsync('git', ['reset', releaseCommitSha, '--hard'], { ignoreFailure: false });
        cli.stopSpinner('Local HEAD is now in sync with the proposal');
      } else {
        cli.error('Local clone is not ready');
        throw new Error('Aborted');
      }
    }

    await this.parseDataFromReleaseCommit();

    const { version } = this;
    cli.startSpinner('Verifying Jenkins CI status');
    if (!jenkinsReady) {
      cli.stopSpinner(
        `Jenkins CI is failing for #${prid}`, cli.SPINNER_STATUS.FAILED);
      const proceed = await cli.prompt('Do you want to proceed?');
      if (!proceed) {
        cli.warn(`Aborting release promotion for version ${version}`);
        throw new Error('Aborted');
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
        throw new Error('Aborted');
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
        throw new Error('Aborted');
      }
    } else {
      cli.stopSpinner(`#${prid} has necessary approvals`);
    }

    // Create and sign the release tag.
    const shouldTagAndSignRelease = await cli.prompt(
      'Tag and sign the release?');
    if (!shouldTagAndSignRelease) {
      cli.warn(`Aborting release promotion for version ${version}`);
      throw new Error('Aborted');
    }
    await this.secureTagRelease();

    // Set up for next release.
    cli.startSpinner('Setting up for next release');
    const workingOnNewReleaseCommit = await this.setupForNextRelease();
    cli.stopSpinner('Successfully set up for next release');

    // Cherry pick release commit to master.
    const shouldCherryPick = await cli.prompt(
      'Cherry-pick release commit to the default branch?', { defaultAnswer: true });
    if (!shouldCherryPick) {
      cli.warn(`Aborting release promotion for version ${version}`);
      throw new Error('Aborted');
    }
    const appliedCleanly = await this.cherryPickToDefaultBranch();

    // Ensure `node_version.h`'s `NODE_VERSION_IS_RELEASE` bit is not updated
    await forceRunAsync('git', ['checkout',
      appliedCleanly
        ? 'HEAD^' // In the absence of conflict, the top of the remote branch is the commit before.
        : 'HEAD', // In case of conflict, HEAD is still the top of the remove branch.
      '--', 'src/node_version.h'],
    { ignoreFailure: false });

    if (appliedCleanly) {
      // There were no conflicts, we have to amend the commit to revert the
      // `node_version.h` changes.
      await forceRunAsync('git', ['commit', ...this.gpgSign, '--amend', '--no-edit', '-n'],
        { ignoreFailure: false });
    } else {
      // There will be remaining cherry-pick conflicts the Releaser will
      // need to resolve, so confirm they've been resolved before
      // proceeding with next steps.
      cli.separator();
      cli.info('Resolve the conflicts and commit the result');
      cli.separator();
      const didResolveConflicts = await cli.prompt(
        'Finished resolving cherry-pick conflicts?', { defaultAnswer: true });
      if (!didResolveConflicts) {
        cli.warn(`Aborting release promotion for version ${version}`);
        throw new Error('Aborted');
      }
    }

    if (existsSync('.git/CHERRY_PICK_HEAD')) {
      cli.info('Cherry-pick is still in progress, attempting to continue it.');
      await forceRunAsync('git', ['cherry-pick', ...this.gpgSign, '--continue'],
        { ignoreFailure: false });
    }

    // Validate release commit on the default branch
    const releaseCommitOnDefaultBranch =
      await forceRunAsync('git', ['show', 'HEAD', '--name-only', '--pretty=format:%s'],
        { captureStdout: true, ignoreFailure: false });
    const [commitTitle, ...modifiedFiles] = releaseCommitOnDefaultBranch.trim().split('\n');
    await this.validateReleaseCommit(commitTitle);
    if (modifiedFiles.some(file => !file.endsWith('.md'))) {
      cli.warn('Some modified files are not markdown, that\'s unusual.');
      cli.info(`The list of modified files: ${modifiedFiles.map(f => `- ${f}`).join('\n')}`);
      if (!await cli.prompt('Do you want to proceed anyway?', { defaultAnswer: false })) {
        throw new Error('Aborted');
      }
    }

    // Push to the remote the release tag, and default, release, and staging branch.
    await this.pushToRemote(workingOnNewReleaseCommit);

    // Promote and sign the release builds.
    await this.promoteAndSignRelease();

    cli.separator();
    cli.ok(`Release promotion for ${version} complete.\n`);
    cli.info(
      'To finish this release, you\'ll need to: \n' +
      ` 1. Check the release at: https://nodejs.org/dist/v${version}\n` +
      ' 2. Create the blog post for nodejs.org.\n' +
      ' 3. Create the release on GitHub.\n' +
      ' 4. Optionally, announce the release on your social networks.\n' +
      ' 5. Tag @nodejs-social-team on #nodejs-release Slack channel.\n');

    cli.separator();
    cli.info('Use the following command to create the GitHub release:');
    cli.separator();
    cli.info(
      'awk \'' +
      `/^## ${this.date}, Version ${this.version.replaceAll('.', '\\.')} /,` +
      '/^<a id="[0-9]+\\.[0-9]+\\.[0-9]+"><\\x2fa>$/{' +
      'print buf; if(firstLine == "") firstLine = $0; else buf = $0' +
    `}' doc/changelogs/CHANGELOG_V${
      this.versionComponents.major}.md | gh release create v${this.version} --verify-tag --latest${
        this.isLTS ? '=false' : ''} --title=${JSON.stringify(this.releaseTitle)} --notes-file -`);
  }

  async verifyPRAttributes() {
    const { cli, prid, owner, repo, req } = this;

    const data = new PRData({ prid, owner, repo }, cli, req);
    await data.getAll();

    const checker = new PRChecker(cli, data, { prid, owner, repo }, { maxCommits: 0 });
    const jenkinsReady = checker.checkJenkinsCI();
    const githubCIReady = checker.checkGitHubCI();
    const isApproved = checker.checkReviewsAndWait(new Date(), false);

    return {
      githubCIReady,
      isApproved,
      jenkinsReady,
      releaseCommitSha: data.commits.at(-1).commit.oid
    };
  }

  async validateReleaseCommit(releaseCommitMessage) {
    const { cli } = this;
    const data = {};
    // Parse out release date.
    if (!/^\d{4}-\d{2}-\d{2}, Version \d/.test(releaseCommitMessage)) {
      cli.error(`Invalid Release commit message: ${releaseCommitMessage}`);
      throw new Error('Aborted');
    }
    data.date = releaseCommitMessage.slice(0, 10);
    const systemDate = new Date().toISOString().slice(0, 10);
    if (data.date !== systemDate) {
      cli.warn(
        `The release date (${data.date}) does not match the system date for today (${systemDate}).`
      );
      if (!await cli.prompt('Do you want to proceed anyway?', { defaultAnswer: false })) {
        throw new Error('Aborted');
      }
    }

    // Parse out release version.
    data.version = releaseCommitMessage.slice(20, releaseCommitMessage.indexOf(' ', 20));
    const version = semver.parse(data.version);
    if (!version) {
      cli.error(`Release commit contains invalid semantic version: ${data.version}`);
      throw new Error('Aborted');
    }

    const { major, minor, patch } = version;
    data.stagingBranch = `v${major}.x-staging`;
    data.versionComponents = {
      major,
      minor,
      patch
    };

    // Parse out LTS status and codename.
    if (!releaseCommitMessage.endsWith(' (Current)')) {
      const match = /'([^']+)' \(LTS\)$/.exec(releaseCommitMessage);
      if (match == null) {
        cli.error('Invalid release commit, it should match either Current or LTS release format');
        throw new Error('Aborted');
      }
      data.isLTS = true;
      data.ltsCodename = match[1];
    }
    return data;
  }

  async parseDataFromReleaseCommit() {
    const { cli, releaseCommitSha } = this;

    const releaseCommitMessage = await forceRunAsync('git', [
      '--no-pager', 'log', '-1',
      releaseCommitSha,
      '--pretty=format:%s'], {
      captureStdout: true,
      ignoreFailure: false
    });

    const releaseCommitData = await this.validateReleaseCommit(releaseCommitMessage);

    this.date = releaseCommitData.date;
    this.version = releaseCommitData.version;
    this.stagingBranch = releaseCommitData.stagingBranch;
    this.versionComponents = releaseCommitData.versionComponents;
    this.isLTS = releaseCommitData.isLTS;
    this.ltsCodename = releaseCommitData.ltsCodename;

    // Check if CHANGELOG show the correct releaser for the current release
    const changeLogDiff = await forceRunAsync('git', [
      '--no-pager', 'diff',
      `${this.releaseCommitSha}^..${this.releaseCommitSha}`,
      '--',
      `doc/changelogs/CHANGELOG_V${this.versionComponents.major}.md`
    ], { captureStdout: true, ignoreFailure: false });
    const headingLine = /^\+## \d{4}-\d{2}-\d{2}, Version \d.+$/m.exec(changeLogDiff);
    if (headingLine == null) {
      cli.error('Cannot find section for the new release in CHANGELOG');
      throw new Error('Aborted');
    }
    this.releaseTitle = headingLine[0].slice(4);
    const expectedLine = `+## ${releaseCommitMessage}, @${this.username}`;
    if (headingLine[0] !== expectedLine &&
        !headingLine[0].startsWith(`${expectedLine} prepared by @`)) {
      cli.error(
        `Invalid section heading for CHANGELOG. Expected "${
          expectedLine.slice(1)
        }", found "${headingLine[0].slice(1)}`
      );
      if (!await cli.prompt('Do you want to proceed anyway?', { defaultAnswer: false })) {
        throw new Error('Aborted');
      }
    }
  }

  async secureTagRelease() {
    const { version, isLTS, ltsCodename, releaseCommitSha } = this;

    const releaseInfo = isLTS ? `${ltsCodename} (LTS)` : '(Current)';

    try {
      await new Promise((resolve, reject) => {
        const api = new gst.API(process.cwd());
        api.sign(`v${version}`, releaseCommitSha, {
          insecure: false,
          m: `${this.date} Node.js v${version} ${releaseInfo} Release`
        }, (err) => err ? reject(err) : resolve());
      });
    } catch (err) {
      const tagCommitSHA = await forceRunAsync('git', [
        'rev-parse', `refs/tags/v${version}^0`
      ], { captureStdout: true, ignoreFailure: false });
      if (tagCommitSHA.trim() !== releaseCommitSha) {
        throw new Error(
          `Existing version tag points to ${tagCommitSHA.trim()} instead of ${releaseCommitSha}`,
          { cause: err }
        );
      }
      await forceRunAsync('git', ['tag', '--verify', `v${version}`], { ignoreFailure: false });
      this.cli.info('Using the existing tag');
    }
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
    for await (const line of nodeVersionFile.readLines({ autoClose: false })) {
      cursor += line.length + 1;
      if (line === `#define NODE_PATCH_VERSION ${versionComponents.patch}`) {
        await nodeVersionFile.write(`${patchVersion}`, cursor - 2, 'ascii');
      } else if (line === '#define NODE_VERSION_IS_RELEASE 1') {
        await nodeVersionFile.write('0', cursor - 2, 'ascii');
        break;
      }
    }

    await nodeVersionFile.close();

    const workingOnVersion =
      `v${versionComponents.major}.${versionComponents.minor}.${patchVersion}`;

    // Create 'Working On' commit.
    await forceRunAsync('git', ['add', filePath], { ignoreFailure: false });
    await forceRunAsync('git', [
      'commit',
      ...this.gpgSign,
      '-m',
      `Working on ${workingOnVersion}`,
      '-m',
      `PR-URL: https://github.com/nodejs/node/pull/${prid}`
    ], { ignoreFailure: false });
    const workingOnNewReleaseCommit = await forceRunAsync('git', ['rev-parse', 'HEAD'],
      { ignoreFailure: false, captureStdout: true });
    return workingOnNewReleaseCommit.trim();
  }

  async pushToRemote(workingOnNewReleaseCommit) {
    const { cli, dryRun, version, versionComponents, stagingBranch } = this;
    const releaseBranch = `v${versionComponents.major}.x`;
    const tagVersion = `v${version}`;

    this.defaultBranch ??= await this.getDefaultBranch();

    let prompt = `Push release tag and commits to ${this.upstream}?`;
    if (dryRun) {
      cli.info(dryRunMessage);
      cli.info('Run the following command to push to remote:');
      cli.info(`git push ${this.upstream} ${
        this.defaultBranch} ${
        tagVersion} ${
        workingOnNewReleaseCommit}:refs/heads/${releaseBranch} ${
        workingOnNewReleaseCommit}:refs/heads/${stagingBranch}`);
      cli.warn('Once pushed, you must not delete the local tag');
      prompt = 'Ready to continue?';
    }

    const shouldPushTag = await cli.prompt(prompt, { defaultAnswer: true });
    if (!shouldPushTag) {
      cli.warn('Aborting release promotion');
      throw new Error('Aborted');
    } else if (dryRun) {
      return;
    }

    cli.startSpinner('Pushing to remote');
    await forceRunAsync('git', ['push', this.upstream, this.defaultBranch, tagVersion,
      `${workingOnNewReleaseCommit}:refs/heads/${releaseBranch}`,
      `${workingOnNewReleaseCommit}:refs/heads/${stagingBranch}`],
    { ignoreFailure: false });
    cli.stopSpinner(`Pushed ${tagVersion}, ${this.defaultBranch}, ${
      releaseBranch}, and ${stagingBranch} to remote`);
    cli.warn('Now that it has been pushed, you must not delete the local tag');
  }

  async promoteAndSignRelease() {
    const { cli, dryRun } = this;
    let prompt = 'Promote and sign release builds?';

    if (dryRun) {
      cli.info(dryRunMessage);
      cli.info('Run the following command to sign and promote the release:');
      cli.info('./tools/release.sh -i <keyPath>');
      prompt = 'Ready to continue?';
    }
    const shouldPromote = await cli.prompt(prompt, { defaultAnswer: true });
    if (!shouldPromote) {
      cli.warn('Aborting release promotion');
      throw new Error('Aborted');
    } else if (dryRun) {
      return;
    }

    // TODO: move this to .ncurc
    const defaultKeyPath = '~/.ssh/node_id_rsa';
    const keyPath = await cli.prompt(
      `Please enter the path to your ssh key (Default ${defaultKeyPath}): `,
      { questionType: 'input', defaultAnswer: defaultKeyPath });

    cli.startSpinner('Signing and promoting the release');
    await forceRunAsync('./tools/release.sh', ['-i', keyPath], { ignoreFailure: false });
    cli.stopSpinner('Release has been signed and promoted');
  }

  async cherryPickToDefaultBranch() {
    this.defaultBranch ??= await this.getDefaultBranch();
    const releaseCommitSha = this.releaseCommitSha;
    await forceRunAsync('git', ['checkout', this.defaultBranch], { ignoreFailure: false });

    await this.tryResetBranch();

    // There might be conflicts, we do not want to treat this as a hard failure,
    // but we want to retain that information.
    try {
      await forceRunAsync('git', ['cherry-pick', ...this.gpgSign, releaseCommitSha],
        { ignoreFailure: false });
      return true;
    } catch {
      return false;
    }
  }
}
