import os from 'node:os';

import {
  getUnmarkedDeprecations,
  updateDeprecations
} from './deprecations.js';
import {
  runAsync, runSync, forceRunAsync
} from './run.js';
import Session from './session.js';
import {
  shortSha, isGhAvailable, getEditor
} from './utils.js';

const isWindows = process.platform === 'win32';

const LINT_RESULTS = {
  SKIPPED: 'skipped',
  FAILED: 'failed',
  SUCCESS: 'success'
};

export default class LandingSession extends Session {
  constructor(cli, req, dir, {
    prid, backport, lint, autorebase, fixupAll,
    checkCI, oneCommitMax
  } = {}) {
    super(cli, dir, prid);
    this.req = req;
    this.backport = backport;
    this.lint = lint;
    this.autorebase = autorebase;
    this.fixupAll = fixupAll;
    this.oneCommitMax = oneCommitMax;
    this.expectedCommitShas = [];
    this.checkCI = !!checkCI;
  }

  get argv() {
    const args = super.argv;
    args.backport = this.backport;
    args.lint = this.lint;
    args.autorebase = this.autorebase;
    args.fixupAll = this.fixupAll;
    args.oneCommitMax = this.oneCommitMax;
    return args;
  }

  async start(metadata) {
    const { cli } = this;
    this.startLanding();
    this.expectedCommitShas =
      metadata.data.commits.map(({ commit }) => commit.oid);
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
    const { cli, repo, owner, prid, expectedCommitShas } = this;

    cli.startSpinner(`Downloading patch for ${prid}`);
    await runAsync('git', [
      'fetch', `https://github.com/${owner}/${repo}.git`,
      `refs/pull/${prid}/merge`]);
    // We fetched the commit that would result if we used `git merge`.
    // ^1 and ^2 refer to the PR base and the PR head, respectively.
    const [base, head] = await runAsync('git',
      ['rev-parse', 'FETCH_HEAD^1', 'FETCH_HEAD^2'],
      { captureStdout: 'lines' });
    const commitShas = await runAsync('git',
      ['rev-list', `${base}..${head}`],
      { captureStdout: 'lines' });
    cli.stopSpinner(`Fetched commits as ${shortSha(base)}..${shortSha(head)}`);
    cli.separator();

    const mismatchedCommits = [
      ...commitShas.filter((sha) => !expectedCommitShas.includes(sha))
        .map((sha) => `Unexpected commit ${sha}`),
      ...expectedCommitShas.filter((sha) => !commitShas.includes(sha))
        .map((sha) => `Missing commit ${sha}`)
    ].join('\n');
    if (mismatchedCommits.length > 0) {
      cli.error(`Mismatched commits:\n${mismatchedCommits}`);
      process.exit(1);
    }

    const commitInfo = { base, head, shas: commitShas };
    this.saveCommitInfo(commitInfo);

    try {
      await forceRunAsync('git', ['cherry-pick', `${base}..${head}`], {
        ignoreFailure: false
      });
    } catch (ex) {
      await forceRunAsync('git', ['cherry-pick', '--abort']);

      cli.error('Failed to apply patches');
      process.exit(1);
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
    return commitInfo;
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

  makeRebaseSuggestion(subjects) {
    const suggestion = this.getRebaseSuggestion(subjects);
    this.cli.log('Please run the following commands to complete landing\n\n' +
      `$ ${suggestion}\n` +
      '$ git node land --continue');
  }

  canAutomaticallyRebase(subjects) {
    return subjects.every(line => !line.startsWith('squash!'));
  }

  async validateLint() {
    // The linter is currently only run on non-Windows platforms.
    if (os.platform() === 'win32') {
      return LINT_RESULTS.SKIPPED;
    }

    if (!this.lint) {
      return LINT_RESULTS.SKIPPED;
    }

    try {
      await runAsync('make', ['lint']);
      return LINT_RESULTS.SUCCESS;
    } catch {
      return LINT_RESULTS.FAILED;
    }
  }

  async tryCompleteLanding(commitInfo) {
    const { cli } = this;
    const subjects = await runAsync('git',
      ['log', '--pretty=format:%s', `${commitInfo.base}..${commitInfo.head}`],
      { captureStdout: 'lines' });

    if (commitInfo.shas.length === 1) {
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
    } else if (this.fixupAll) {
      cli.log(`There are ${subjects.length} commits in the PR. ` +
        'Attempting to fixup everything into first commit.');
      await runAsync('git', ['reset', '--soft', `HEAD~${subjects.length - 1}`]);
      await runAsync('git', ['commit', '--amend', '--no-edit']);
      return await this.amend() && this.final();
    } else if (this.autorebase && this.canAutomaticallyRebase(subjects)) {
      // Run git rebase in interactive mode with autosquash but without editor
      // so that it will perform everything automatically.
      cli.log(`There are ${subjects.length} commits in the PR. ` +
        'Attempting autorebase.');
      const { upstream, branch } = this;
      const assumeYes = this.cli.assumeYes ? '--yes' : '';
      const msgAmend = `-x "git node land --amend ${assumeYes}"`;
      try {
        await forceRunAsync('git',
          ['rebase', `${upstream}/${branch}`, '-i', '--autosquash', msgAmend],
          {
            ignoreFailure: false,
            spawnArgs: {
              shell: true,
              env: { ...process.env, GIT_SEQUENCE_EDITOR: ':' }
            }
          });
        return this.final();
      } catch (e) {
        await runAsync('git', ['rebase', '--abort']);
        const count = subjects.length;
        cli.log(`Couldn't rebase ${count} commits in the PR automatically`);
        this.makeRebaseSuggestion(subjects);
      }
    } else {
      this.makeRebaseSuggestion(subjects);
    }
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

    const commitInfo = await this.downloadAndPatch();

    const cleanLint = await this.validateLint();
    if (cleanLint === LINT_RESULTS.FAILED) {
      const tryFixLint = await cli.prompt(
        'Lint failed - try fixing with \'make lint-js-fix\'?');
      if (tryFixLint) {
        await runAsync('make', ['lint-js-fix']);
        const fixed = await this.validateLint();
        if (fixed === LINT_RESULTS.FAILED) {
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
    } else if (cleanLint === LINT_RESULTS.SUCCESS) {
      cli.ok('Lint passed cleanly');
    }

    this.startAmending();

    await this.tryCompleteLanding(commitInfo);
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

    const editor = await getEditor({ git: true });
    if (editor) {
      try {
        await forceRunAsync(
          editor,
          [`"${messageFile}"`],
          { ignoreFailure: false, spawnArgs: { shell: true } }
        );
        await runAsync('git', ['commit', '--amend', '-F', messageFile]);
        return true;
      } catch {
        cli.error('Failed to edit the message using the configured editor');
      }
    }

    cli.log(`Please manually edit ${messageFile}, then run\n` +
      `\`git commit --amend -F ${messageFile}\` ` +
      'to finish amending the message');
    process.exit(1);  // make it work with git rebase -x
  }

  async final() {
    const {
      cli, owner, repo, upstream, branch, prid, oneCommitMax
    } = this;

    // Check that git rebase/am has been completed.
    if (!this.readyToFinal()) {
      cli.warn('Not yet ready to final');
      cli.log('A git rebase/am is in progress.' +
        ' Please complete it before running git node land --final');
      return;
    };

    const stray = this.getStrayCommits();
    if (stray.length > 1) {
      const forceLand = await cli.prompt(
        'There is more than one commit in the PR. ' +
        'Do you still want to land it?',
        { defaultAnswer: !oneCommitMax });

      if (!forceLand) {
        cli.info(
          'Use --fixupAll option, squash the PR manually or land the PR from ' +
          'the command line.'
        );
        process.exit(1);
      }
    }
    const strayVerbose = this.getStrayCommits(true);
    const validateCommand = new URL(
      '../node_modules/.bin/core-validate-commit' + (isWindows ? '.cmd' : ''),
      import.meta.url
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
    cli.log('Temporary files removed.');
    cli.log('To finish landing:');
    cli.log('1. Run: ');
    cli.log(`   git push ${upstream} ${branch}`);
    const url = `https://github.com/${owner}/${repo}/pull/${prid}`;
    cli.log(`2. Post "Landed in ${willBeLanded}" in ${url}`);
    if (isGhAvailable()) {
      cli.log(`   gh pr comment ${prid} --body "Landed in ${willBeLanded}"`);
      cli.log(`   gh pr close ${prid}`);
    }
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
      if (this.cherryPickInProgress()) {
        cli.log('Looks like you are resolving a `git cherry-pick` conflict');
        cli.log('Please run `git status` for help');
      } else {
        // Conflicts has been resolved - amend.
        this.startAmending();
        return this.tryCompleteLanding(this.commitInfo);
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

  async warnForWrongBranch() {
    if (super.warnForWrongBranch()) {
      return true;
    }
    const rev = this.getCurrentBranch();
    const { repository: { defaultBranchRef } } = await this.req.gql(
      'DefaultBranchRef',
      { owner: this.owner, repo: this.repo });
    if ((rev === 'master' || rev === 'main') && defaultBranchRef.name !== rev) {
      this.cli.warn(`You are running git-node-land on \`${rev}\`,` +
                    ` but the default branch is \`${defaultBranchRef.name}\`.`);
      this.cli.setExitCode(1);
      return true;
    }
  }
}
