'use strict';

const path = require('path');

const {
  runAsync, runSync, forceRunAsync
} = require('./run');
const Session = require('./session');

const isWindows = process.platform === 'win32';

class LandingSession extends Session {
  constructor(cli, req, dir, prid, config) {
    super(dir, prid, config);
    this.cli = cli;
    this.req = req;
    const { upstream, owner, repo } = this;
    const upstreamHref = runSync('git', [
      'config', '--get',
      `remote.${upstream}.url`]).trim();
    if (!new RegExp(`${owner}/${repo}(?:.git)?$`).test(upstreamHref)) {
      cli.warn('Remote repository URL does not point to the expected ' +
        `repository ${owner}/${repo}`);
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

  async downloadAndPatch() {
    const { cli, req, repo, owner, prid } = this;

    // TODO(joyeecheung): restore previously downloaded patches
    cli.startSpinner(`Downloading patch for ${prid}`);
    const patch = await req.text(
      `https://github.com/${owner}/${repo}/pull/${prid}.patch`);
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
        process.exit(1);
      }
    }
    cli.ok('Patches applied');
    return patch;
  }

  getRebaseSuggestion(subjects) {
    const { upstream, branch } = this;
    let command = `git rebase ${upstream}/${branch} -i`;
    command += ' -x "git node land --amend"';

    const squashes = subjects.filter(
      line => line.includes('fixup!') || line.includes('squash!'));

    if (squashes.length !== 0) {
      command += ' --autosquash';
    }

    return command;
  }

  async suggestAfterPatch(patch) {
    const { cli } = this;
    const subjects = patch.match(/Subject: \[PATCH.*?\].*/g);
    if (!subjects) {
      cli.warn('Cannot get number of commits in the patch. ' +
        'It seems to be malformed');
      return;
    }

    // XXX(joyeecheung) we cannot guarantee that no one will put a subject
    // line in the commit message but that seems unlikely (some deps update
    // might do that).
    if (subjects.length === 1) {
      // assert(subjects[0].startsWith('Subject: [PATCH]'))
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

    const suggestion = this.getRebaseSuggestion(subjects);

    cli.log(`There are ${subjects.length} commits in the PR`);
    cli.log('Please run the following command to complete landing\n\n' +
            `$ ${suggestion}`);
  }

  async apply() {
    const { cli } = this;
    if (!this.isApplying()) {
      cli.warn('This session can not proceed to apply patches, ' +
        'run `git node land --abort`');
      return;
    }
    await this.tryResetBranch();

    const patch = await this.downloadAndPatch();
    this.startAmending();
    await this.suggestAfterPatch(patch);
  }

  getCurrentRev() {
    return runSync('git', ['rev-parse', 'HEAD']).trim();
  }

  getCurrentBranch() {
    return runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  }

  async amend() {
    const { cli } = this;
    if (!this.readyToAmend()) {
      cli.warn('Not yet ready to amend, run `git node land --abort`');
      return;
    }
    this.startAmending();

    const rev = this.getCurrentRev();
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
    process.exit(1);  // make it work with git rebase -x
  }

  async final() {
    const { cli, owner, repo, upstream, branch, prid } = this;

    if (!this.readyToFinal()) {  // check git rebase/am has been done
      cli.warn('Not yet ready to final');
      cli.log('A git rebase/am is in progress.' +
        ' Please complete it before running git node land --final');
      return;
    };

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
    const url = `https://github.com/${owner}/${repo}/pull/${prid}`;
    cli.log(`2. Post in ${url}: \`Landed in ${willBeLanded}\``);

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
    if (this.isApplying()) {
      // We are resolving conflict
      if (this.amInProgress()) {
        cli.log('Looks like you are resolving a `git am` conflict');
        cli.log('Please run `git status` for help');
      } else {  // The conflict has been resolved
        this.startAmending();
        return this.suggestAfterPatch(this.patch);
      }
      return;
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
    return runSync('git', ['rev-parse', `${upstream}/${branch}`]).trim();
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
      `Do you want to try reset the local ${branch} branch to ${branchName}?`);
    if (shouldResetHead) {
      await this.tryResetHead();
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
    let rev = this.getCurrentBranch();
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
      `   reconfigure the target branch with:\n\n` +
      `  $ ncu-config set branch ${rev}`);
    cli.separator();
    return true;
  }
}

module.exports = LandingSession;
