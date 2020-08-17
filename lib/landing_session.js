'use strict';

const path = require('path');
const os = require('os');
const {
  getUnmarkedDeprecations,
  updateDeprecations
} = require('./deprecations');

const {
  runAsync, runSync, forceRunAsync
} = require('./run');
const Session = require('./session');
const { shortSha } = require('./utils');

const isWindows = process.platform === 'win32';

class LandingSession extends Session {
  constructor(cli, req, dir, prid, backport) {
    super(cli, dir, prid);
    this.req = req;
    this.backport = backport;
  }

  get argv() {
    const args = super.argv;
    args.backport = this.backport;
    return args;
  }

  async start(metadata) {
    const { cli } = this;
    this.startLanding();
    const status = metadata.status ? 'should be ready' : 'is not ready';
    // NOTE(mmarchini): default answer is yes. If --yes is given, we need to be
    // more careful though, and we change the default to the result of our
    // metadata check.
    const defaultAnswer = !cli.assumeYes ? true : metadata.status;
    const shouldContinue = await cli.prompt(
      `This PR ${status} to land, do you want to continue?`, { defaultAnswer });
    if (!shouldContinue) {
      cli.setExitCode(1);
      return this.abort(false);
    }

    this.saveMetadata(metadata);
    this.startApplying();
    return this.apply();
  }

  async abort(tryResetBranch = true) {
    try {
      const { cli } = this;
      this.cleanFiles();
      if (tryResetBranch) {
        await this.tryResetBranch();
      }
      cli.ok(`Aborted \`git node land\` session in ${this.ncuDir}`);
    } catch (ex) {
      const { cli } = this;
      cli.setExitCode(1);
      cli.error(`Couldn't abort \`git node land\` session in ${this.ncuDir}`);
      throw ex;
    }
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
      await forceRunAsync('git', ['am', this.patchPath], {
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
          this.patchPath
        ]);
      } else {
        cli.error('Failed to apply patches');
        process.exit(1);
      }
    }

    // Check for and maybe assign any unmarked deprecations in the codebase.
    if (this.updateDeprecations !== 'yes') {
      const unmarkedDeprecations = await getUnmarkedDeprecations();
      const unmarkedDepCount = unmarkedDeprecations.length;
      if (unmarkedDepCount > 0) {
        cli.startSpinner('Assigning deprecation numbers to DEPOXXX items');

        // Update items then stage files and amend the last commit.
        await updateDeprecations(unmarkedDeprecations);
        await runAsync('git', ['add', 'doc', 'lib', 'src', 'test']);
        await runAsync('git', ['commit', '--amend', '--no-edit']);

        cli
          .stopSpinner(`Updated ${unmarkedDepCount} DEPOXXX items in codebase`);
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

  async validateLint() {
    // The linter is currently only run on non-Windows platforms.
    if (os.platform() === 'win32') {
      return true;
    }

    const linted = await runAsync('make', ['lint']);
    return linted;
  }

  async tryCompleteLanding(patch) {
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
    cli.log('Please run the following commands to complete landing\n\n' +
            `$ ${suggestion}\n` +
            '$ git node land --continue');
  }

  async apply() {
    const { cli } = this;

    // Bail if another landing session is currently in progress.
    if (!this.isApplying()) {
      cli.warn('Landing session already in progress - ' +
        'to start a new one run `git node land --abort`');
      return;
    }
    await this.tryResetBranch();

    const patch = await this.downloadAndPatch();

    const cleanLint = await this.validateLint();
    if (!cleanLint) {
      const tryFixLint = await cli.prompt(
        'Lint failed - try fixing with \'make lint-js-fix\'?');
      if (tryFixLint) {
        await runAsync('make', ['lint-js-fix']);
        const fixed = await this.validateLint();
        if (!fixed) {
          cli.warn('Patch still contains lint errors. ' +
            'Please fix manually before proceeding');
        }
      }

      const correctedLint = await cli.prompt('Corrected all lint errors?');
      if (correctedLint) {
        await runAsync('git', ['add', '.']);

        // Final message will be edited later - don't try to change it here.
        await runAsync('git', ['commit', '--amend', '--no-edit']);
      } else {
        cli.info('Please fix lint errors and then run ' +
        '`git node land --amend` followed by ' +
        '`git node land --continue`.');
        process.exit(1);
      }
    }

    this.startAmending();

    await this.tryCompleteLanding(patch);
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

    const BACKPORT_RE = /BACKPORT-PR-URL\s*:\s*(\S+)/i;
    const PR_RE = /PR-URL\s*:\s*(\S+)/i;
    const REVIEW_RE = /Reviewed-By\s*:\s*(\S+)/i;

    for (const line of metadata) {
      if (original.includes(line)) {
        if (line) {
          cli.warn(`Found ${line}, skipping..`);
        }
      } else {
        if (line.match(BACKPORT_RE)) {
          let prIndex = amended.findIndex(datum => datum.match(PR_RE));
          if (prIndex === -1) {
            prIndex = amended.findIndex(datum => datum.match(REVIEW_RE)) - 1;
          }
          amended.splice(prIndex + 1, 0, line);
        } else {
          amended.push(line);
        }
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

    // Check that git rebase/am has been completed.
    if (!this.readyToFinal()) {
      cli.warn('Not yet ready to final');
      cli.log('A git rebase/am is in progress.' +
        ' Please complete it before running git node land --final');
      return;
    };

    const stray = this.getStrayCommits();
    const strayVerbose = this.getStrayCommits(true);
    const validateCommand = path.join(
      __dirname,
      '../node_modules/.bin/core-validate-commit' + (isWindows ? '.cmd' : '')
    );

    try {
      await forceRunAsync(validateCommand, stray, { ignoreFailure: false });
    } catch (e) {
      let forceLand = false;
      if (e.code === 1) {
        forceLand = await cli.prompt(
          'The commit did not pass the validation. ' +
          'Do you still want to land it?',
          { defaultAnswer: false });
      }

      if (!forceLand) {
        cli.info('Please fix the commit message and try again.');
        process.exit(1);
      }
    }

    cli.separator();
    cli.log('The following commits are ready to be pushed to ' +
      `${upstream}/${branch}`);
    cli.log(`- ${strayVerbose.join('\n- ')}`);
    cli.separator();

    let willBeLanded = shortSha(stray[stray.length - 1]);
    if (stray.length > 1) {
      const head = shortSha(this.getUpstreamHead());
      willBeLanded = `${head}...${willBeLanded}`;
    }

    this.cleanFiles();
    cli.log('Temporary files removed');
    cli.log('To finish landing:');
    cli.log(`1. Run \`git push ${upstream} ${branch}\``);
    const url = `https://github.com/${owner}/${repo}/pull/${prid}`;
    cli.log(`2. Post "Landed in ${willBeLanded}" in ${url}`);
  }

  async continue() {
    const { cli } = this;
    if (this.readyToFinal()) {
      cli.log('Running `final`..');
      return this.final();
    }
    if (this.readyToAmend()) {
      cli.log('Running `amend`..');
      return this.amend();
    }
    if (this.isApplying()) {
      // We're still resolving conflicts.
      if (this.amInProgress()) {
        cli.log('Looks like you are resolving a `git am` conflict');
        cli.log('Please run `git status` for help');
      } else {
        // Conflicts has been resolved - amend.
        this.startAmending();
        return this.tryCompleteLanding(this.patch);
      }
      return;
    }
    if (this.hasStarted()) {
      cli.log('Running `apply`..');
      return this.apply();
    }
    cli.log(
      'Please run `git node land <PRID> to start a landing session`');
  }

  async status() {
    // TODO
  }
}

module.exports = LandingSession;
