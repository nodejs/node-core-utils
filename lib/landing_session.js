'use strict';

const path = require('path');
const { URL } = require('url');

const {
  runAsync, runSync, forceRunAsync, exit
} = require('./run');
const Session = require('./session');

const isWindows = process.platform === 'win32';

class LandingSession extends Session {
  constructor(cli, req, dir, prid, config) {
    super(dir, prid, config);
    this.cli = cli;
    this.req = req;
    const { upstream, owner, repo } = this;
    const upstreamHref = runSync('git', ['config', '--get',
      `remote.${upstream}.url`]);
    let warned = false;
    try {
      const { hostname, pathname } = new URL(upstreamHref);
      if (hostname !== 'github.com') {
        warned = true;
        cli.warn('Remote repository URL does not point to the expected ' +
          'host "github.com"');
      }
      if (new RegExp(`^/${owner}/${repo}(?:.git)?$`).test(pathname) !== true) {
        warned = true;
        cli.warn('Remote repository URL does not point to the expected ' +
          `repository /${owner}/${repo}`);
      }
    } catch (e) {
      warned = true;
      cli.warn('Could not parse remote repository URL %j, this might be ' +
        'because it is not a HTTPS URL', upstreamHref);
    }
    if (warned) {
      cli.warn('You might want to change the remote repository URL with ' +
        `\`git remote set-url ${
          upstream
        } "https://github.com/${owner}/${repo}"\``);
    }
  }

  async start(metadata) {
    const { cli } = this;
    this.startLanding();
    const status = metadata.status ? 'should be ready' : 'is not ready';
    const shouldContinue = await cli.prompt(
      `This PR ${status} to land, do you want to continue?`);
    if (!shouldContinue) {
      return this.abort();
    }

    this.saveMetadata(metadata);
    this.startApplying();
    return this.apply();
  }

  async abort() {
    const { cli } = this;
    this.cleanFiles();
    await this.tryResetBranch();
    cli.ok(`Aborted \`git node land\` session in ${this.ncuDir}`);
  }

  async apply() {
    const { cli, req, repo, owner, prid } = this;

    if (!this.readyToApply()) {
      cli.warn('This session can not proceed to apply patches, ' +
        'run `git node land --abort`');
      return;
    }
    await this.tryResetBranch();

    // TODO: restore previously downloaded patches
    cli.startSpinner(`Downloading patch for ${prid}`);
    const patch = await req.promise({
      url: `https://github.com/${owner}/${repo}/pull/${prid}.patch`
    });
    this.savePatch(patch);
    cli.stopSpinner(`Downloaded patch to ${this.patchPath}`);
    cli.separator();
    // TODO: check that patches downloaded match metadata.commits
    try {
      await forceRunAsync('git', ['am', '--whitespace=fix', this.patchPath], {
        ignoreFailure: false
      });
    } catch (ex) {
      const should3Way = await cli.prompt(
        'The normal `git am` failed. Do you want to retry with 3-way merge?');
      if (should3Way) {
        await forceRunAsync('git', ['am', '--abort']);
        await runAsync('git', [
          'am',
          '-3',
          '--whitespace=fix',
          this.patchPath
        ]);
      } else {
        cli.error('Failed to apply patches');
        exit();
      }
    }
    cli.ok('Patches applied');

    this.startAmending();
    if (/Subject: \[PATCH\]/.test(patch)) {
      const shouldAmend = await cli.prompt(
        'There is only one commit in this PR.\n' +
        'do you want to amend the commit message?');
      if (!shouldAmend) {
        return;
      }
      const canFinal = await this.amend();
      if (!canFinal) {
        return;
      }
      return this.final();
    }

    const re = /Subject: \[PATCH 1\/(\d+)\]/;
    const match = patch.match(re);
    if (!match) {
      cli.warn('Cannot get number of commits in the patch. ' +
        'It seems to be malformed');
      return;
    }
    const { upstream, branch } = this;
    cli.log(
      `There are ${match[1]} commits in the PR.\n` +
      `Please run \`git rebase ${upstream}/${branch} -i\`, put "edit" on ` +
      'every commit that\'s gonna stay and use `git node land --amend` to ' +
      'amend the commit messages');
    // TODO: do git rebase automatically?
  }

  async amend() {
    const { cli } = this;
    if (!this.readyToAmend()) {
      cli.warn('Not yet ready to amend, run `git node land --abort`');
      return;
    }

    const rev = runSync('git', ['rev-parse', 'HEAD']);
    const original = runSync('git', [
      'show', 'HEAD', '-s', '--format=%B'
    ]).trim();
    const metadata = this.metadata.trim().split('\n');
    const amended = original.split('\n');
    if (amended[amended.length - 1] !== '') {
      amended.push('');
    }

    for (const line of metadata) {
      if (original.includes(line)) {
        if (line) {
          cli.warn(`Found ${line}, skipping..`);
        }
      } else {
        amended.push(line);
      }
    }

    const message = amended.join('\n');
    const messageFile = this.saveMessage(rev, message);
    cli.separator('New Message');
    cli.log(message.trim());
    const takeMessage = await cli.prompt('Use this message?');
    if (takeMessage) {
      await runAsync('git', ['commit', '--amend', '-F', messageFile]);
      return true;
    }

    // TODO: fire the configured git editor on that file
    cli.log(`Please manually edit ${messageFile}, then run\n` +
      `\`git commit --amend -F ${messageFile}\` ` +
      'to finish amending the message');
    return false;
  }

  async final() {
    const { cli } = this;
    if (!this.readyToFinal()) {  // check git rebase/am has been done
      cli.warn('Not yet ready to final');
      return;
    }
    const upstream = this.upstream;
    const branch = this.branch;
    const notYetPushed = this.getNotYetPushedCommits();
    const notYetPushedVerbose = this.getNotYetPushedCommits(true);
    const validateCommand = path.join(
      __dirname,
      '../node_modules/.bin/core-validate-commit' + (isWindows ? '.cmd' : '')
    );
    await runAsync(validateCommand, notYetPushed);

    cli.separator();
    cli.log('The following commits are ready to be pushed to ' +
      `${upstream}/${branch}`);
    cli.log(`- ${notYetPushedVerbose.join('\n- ')}`);
    cli.separator();

    let willBeLanded = notYetPushed[notYetPushed.length - 1].slice(0, 7);
    if (notYetPushed.length > 1) {
      const head = this.getUpstreamHead().slice(0, 7);
      willBeLanded = `${head}...${willBeLanded}`;
    }
    cli.log('To finish landing:');
    cli.log(`1. Run \`git push ${upstream} ${branch}\``);
    cli.log(`2. Post in the PR: \`Landed in ${willBeLanded}\``);

    const shouldClean = await cli.prompt('Clean up generated temporary files?');
    if (shouldClean) {
      this.cleanFiles();
    }
  }

  async continue() {
    const { cli } = this;
    if (this.readyToFinal()) {
      cli.log(`Running \`final\`..`);
      return this.final();
    }
    if (this.readyToAmend()) {
      cli.log(`Running \`amend\`..`);
      return this.amend();
    }
    if (this.readyToApply()) {
      cli.log(`Running \`apply\`..`);
      return this.apply();
    }
    if (this.hasStarted()) {
      cli.log(`Running \`apply\`..`);
      return this.apply();
    }
    cli.log(
      'Please run `git node land <PRID> to start a landing session`');
  }

  async status() {
    // TODO
  }

  getNotYetPushedCommits(verbose) {
    const { upstream, branch } = this;
    const ref = `${upstream}/${branch}...HEAD`;
    const gitCmd = verbose
      ? ['log', '--oneline', '--reverse', ref] : ['rev-list', '--reverse', ref];
    const revs = runSync('git', gitCmd).trim();
    return revs ? revs.split('\n') : [];
  }

  getUpstreamHead(verbose) {
    const { upstream, branch } = this;
    return runSync('git', ['rev-parse', `${upstream}/${branch}^1`]).trim();
  }

  async tryAbortAm() {
    const { cli } = this;
    if (!this.amInProgress()) {
      return cli.ok('No git am in progress');
    }
    const shouldAbortAm = await cli.prompt(
      'Abort previous git am sessions?');
    if (shouldAbortAm) {
      await forceRunAsync('git', ['am', '--abort']);
      cli.ok('Aborted previous git am sessions');
    }
  }

  async tryAbortRebase() {
    const { cli } = this;
    if (!this.rebaseInProgress()) {
      return cli.ok('No git rebase in progress');
    }
    const shouldAbortRebase = await cli.prompt(
      'Abort previous git rebase sessions?');
    if (shouldAbortRebase) {
      await forceRunAsync('git', ['rebase', '--abort']);
      cli.ok('Aborted previous git rebase sessions');
    }
  }

  async tryResetHead() {
    const { cli, upstream, branch } = this;
    const branchName = `${upstream}/${branch}`;
    cli.startSpinner(`Bringing ${branchName} up to date...`);
    await runAsync('git', ['fetch', upstream, branch]);
    cli.stopSpinner(`${branchName} is now up-to-date`);
    const notYetPushed = this.getNotYetPushedCommits(true);
    if (!notYetPushed.length) {
      return;
    }
    cli.log(`Found stray commits in ${branchName}:\n` +
      ` - ${notYetPushed.join('\n - ')}`);
    const shouldReset = await cli.prompt(`Reset to ${branchName}?`);
    if (shouldReset) {
      await runAsync('git', ['reset', '--hard', branchName]);
      cli.ok(`Reset to ${branchName}`);
    }
  }

  async tryResetBranch() {
    const { cli, upstream, branch } = this;
    await this.tryAbortAm();
    await this.tryAbortRebase();

    const branchName = `${upstream}/${branch}`;
    const shouldResetHead = await cli.prompt(
      `Do you want to try reset the branch to ${branchName}?`);
    if (shouldResetHead) {
      await this.tryResetHead();
    }
  }
}

module.exports = LandingSession;
