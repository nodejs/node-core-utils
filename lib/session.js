'use strict';

const path = require('path');
const fs = require('fs');
const { getMergedConfig, getNcuDir } = require('./config');
const rimraf = require('rimraf');
const { readJson, writeJson, readFile, writeFile } = require('./file');
const {
  runAsync, runSync, forceRunAsync
} = require('./run');
const {
  shortSha
} = require('./utils');

const APPLYING = 'APPLYING';
const STARTED = 'STARTED';
const AMENDING = 'AMENDING';

class Session {
  constructor(cli, dir, prid) {
    this.cli = cli;
    this.dir = dir;
    this.prid = prid;
    this.config = getMergedConfig(this.dir);

    const { upstream, owner, repo } = this;

    if (this.warnForMissing()) {
      throw new Error('Failed to create new session');
    }

    const upstreamHref = runSync('git', [
      'config', '--get',
      `remote.${upstream}.url`]).trim();
    if (!new RegExp(`${owner}/${repo}(?:.git)?$`).test(upstreamHref)) {
      cli.warn('Remote repository URL does not point to the expected ' +
        `repository ${owner}/${repo}`);
    }
  }

  get session() {
    return readJson(this.sessionPath);
  }

  get gitDir() {
    return path.join(this.dir, '.git');
  }

  get ncuDir() {
    return getNcuDir(this.dir);
  }

  get argv() {
    return {
      owner: this.owner,
      repo: this.repo,
      upstream: this.upstream,
      branch: this.branch,
      readme: this.readme,
      waitTimeSingleApproval: this.waitTimeSingleApproval,
      waitTimeMultiApproval: this.waitTimeMultiApproval,
      ciType: this.ciType,
      prid: this.prid
    };
  }

  get sessionPath() {
    return path.join(this.ncuDir, 'land');
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

  get branch() {
    return this.config.branch;
  }

  get readme() {
    return this.config.readme;
  }

  get waitTimeSingleApproval() {
    return this.config.waitTimeSingleApproval;
  }

  get waitTimeMultiApproval() {
    return this.config.waitTimeMultiApproval;
  }

  get ciType() {
    return this.config.ciType || 'jenkins';
  }

  get pullName() {
    return `${this.owner}/${this.repo}/pulls/${this.prid}`;
  }

  get pullDir() {
    return path.join(this.ncuDir, `${this.prid}`);
  }

  startLanding() {
    writeJson(this.sessionPath, {
      state: STARTED,
      prid: this.prid,
      config: this.config
    });
  }

  // TODO(joyeecheung): more states
  // - STARTED (fetching metadata)
  // - DOWNLOADING (downloading the patch)
  // - PATCHING (git am)
  // - AMENDING (git rebase or just amending messages)
  // - DONE

  startApplying() {
    this.updateSession({
      state: APPLYING
    });
  }

  startAmending() {
    this.updateSession({
      state: AMENDING
    });
  }

  cleanFiles() {
    var sess;
    try {
      sess = this.session;
    } catch (err) {
      return rimraf.sync(this.sessionPath);
    }

    if (sess.prid && sess.prid === this.prid) {
      rimraf.sync(this.pullDir);
    }
    rimraf.sync(this.sessionPath);
  }

  get statusPath() {
    return path.join(this.pullDir, 'status');
  }

  get status() {
    return readJson(this.statusPath);
  }

  get metadataPath() {
    return path.join(this.pullDir, 'metadata');
  }

  get metadata() {
    return readFile(this.metadataPath);
  }

  get patchPath() {
    return path.join(this.pullDir, 'patch');
  }

  get patch() {
    return readFile(this.patchPath);
  }

  getMessagePath(rev) {
    return path.join(this.pullDir, `${shortSha(rev)}-message`);
  }

  updateSession(update) {
    const old = this.session;
    writeJson(this.sessionPath, Object.assign(old, update));
  }

  saveStatus(status) {
    writeJson(this.statusPath, status);
  }

  saveMetadata(status) {
    writeFile(this.metadataPath, status.metadata);
  }

  savePatch(patch) {
    writeFile(this.patchPath, patch);
  }

  saveMessage(rev, message) {
    const file = this.getMessagePath(rev);
    writeFile(file, message);
    return file;
  }

  hasStarted() {
    return !!this.session.prid && this.session.prid === this.prid;
  }

  isApplying() {
    return this.session.state === APPLYING;
  }

  readyToAmend() {
    if (this.session.state === AMENDING) {
      return true;
    } else if (this.isApplying()) {
      return !this.amInProgress();
    } else {
      return false;
    }
  }

  readyToFinal() {
    if (this.amInProgress()) {
      return false;  // git am/rebase in progress
    }
    return this.session.state === AMENDING;
  }

  // Refs: https://github.com/git/git/blob/99de064/git-rebase.sh#L208-L228
  amInProgress() {
    const amPath = path.join(this.gitDir, 'rebase-apply', 'applying');
    return fs.existsSync(amPath);
  }

  rebaseInProgress() {
    if (this.amInProgress()) {
      return false;
    }

    const normalRebasePath = path.join(this.gitDir, 'rebase-apply');
    const mergeRebasePath = path.join(this.gitDir, 'rebase-merge');
    return fs.existsSync(normalRebasePath) || fs.existsSync(mergeRebasePath);
  }

  restore() {
    const sess = this.session;
    if (sess.prid) {
      this.prid = sess.prid;
      this.config = sess.config;
    }
    return this;
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

  async tryResetBranch() {
    const { cli, upstream, branch } = this;
    await this.tryAbortAm();
    await this.tryAbortRebase();

    const branchName = `${upstream}/${branch}`;
    const shouldResetHead = await cli.prompt(
      `Do you want to try reset the local ${branch} branch to ${branchName}?`);
    if (shouldResetHead) {
      await this.tryResetHead();
    }
  }

  getCurrentRev() {
    return runSync('git', ['rev-parse', 'HEAD']).trim();
  }

  getCurrentBranch() {
    return runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  }

  getUpstreamHead() {
    const { upstream, branch } = this;
    return runSync('git', ['rev-parse', `${upstream}/${branch}`]).trim();
  }

  getStrayCommits(verbose) {
    const { upstream, branch } = this;
    const ref = `${upstream}/${branch}...HEAD`;
    const gitCmd = verbose
      ? ['log', '--oneline', '--reverse', ref] : ['rev-list', '--reverse', ref];
    const revs = runSync('git', gitCmd).trim();
    return revs ? revs.split('\n') : [];
  }

  async tryResetHead() {
    const { cli, upstream, branch } = this;
    const branchName = `${upstream}/${branch}`;
    cli.startSpinner(`Bringing ${branchName} up to date...`);
    await runAsync('git', ['fetch', upstream, branch]);
    cli.stopSpinner(`${branchName} is now up-to-date`);
    const stray = this.getStrayCommits(true);
    if (!stray.length) {
      return;
    }
    cli.log(`${branch} is out of sync with ${branchName}. ` +
            'Mismatched commits:\n' +
      ` - ${stray.join('\n - ')}`);
    const shouldReset = await cli.prompt(`Reset to ${branchName}?`);
    if (shouldReset) {
      await runAsync('git', ['reset', '--hard', branchName]);
      cli.ok(`Reset to ${branchName}`);
    }
  }

  warnForMissing() {
    const { upstream, branch, cli } = this;
    const missing = !upstream || !branch;
    if (!branch) {
      cli.warn('You have not told git-node what branch you are trying' +
               ' to land commits on.');
      cli.separator();
      cli.info(
        'For example, if your want to land commits on the ' +
        '`master` branch, you can run:\n\n' +
        '  $ ncu-config set branch master');
      cli.separator();
    }
    if (!upstream) {
      cli.warn('You have not told git-node the remote you want to sync with.');
      cli.separator();
      cli.info(
        'For example, if your remote pointing to nodejs/node is' +
        ' `remote-upstream`, you can run:\n\n' +
        '  $ ncu-config set upstream remote-upstream');
      cli.separator();
    }
    return missing;
  }

  warnForWrongBranch() {
    const { branch, cli } = this;
    const rev = this.getCurrentBranch();
    if (rev === 'HEAD') {
      cli.warn(
        'You are in detached HEAD state. Please run git-node on a valid ' +
        'branch');
      return true;
    }
    if (rev === branch) {
      return false;
    }
    cli.warn(
      `You are running git-node-land on \`${rev}\`,\n   but you have` +
      ` configured \`${branch}\` to be the branch to land commits.`);
    cli.separator();
    cli.info(
      `You can switch to \`${branch}\` with \`git checkout ${branch}\`, or\n` +
      '   reconfigure the target branch with:\n\n' +
      `  $ ncu-config set branch ${rev}`);
    cli.separator();
    return true;
  // TODO warn if backporting onto master branch
  }
}

module.exports = Session;
