import os from 'node:os';
import path from 'node:path';
import { getMetadata } from '../components/metadata.js';

import {
  runAsync, runSync, forceRunAsync
} from './run.js';
import { writeFile } from './file.js';
import {
  shortSha, getEditor
} from './utils.js';
import { getNcuDir } from './config.js';

const LINT_RESULTS = {
  SKIPPED: 'skipped',
  FAILED: 'failed',
  SUCCESS: 'success'
};

export default class CheckPick {
  constructor(prid, dir, cli, {
    owner,
    repo,
    lint,
    includeCVE
  } = {}) {
    this.prid = prid;
    this.cli = cli;
    this.dir = dir;
    this.options = { owner, repo, lint, includeCVE };
  }

  get includeCVE() {
    return this.options.includeCVE ?? false;
  }

  get owner() {
    return this.options.owner || 'nodejs';
  }

  get repo() {
    return this.options.repo || 'node';
  }

  get lint() {
    return this.options.lint;
  }

  getUpstreamHead() {
    const { upstream, branch } = this;
    return runSync('git', ['rev-parse', `${upstream}/${branch}`]).trim();
  }

  getCurrentRev() {
    return runSync('git', ['rev-parse', 'HEAD']).trim();
  }

  getStrayCommits(verbose) {
    const { upstream, branch } = this;
    const ref = `${upstream}/${branch}...HEAD`;
    const gitCmd = verbose
      ? ['log', '--oneline', '--reverse', ref]
      : ['rev-list', '--reverse', ref];
    const revs = runSync('git', gitCmd).trim();
    return revs ? revs.split('\n') : [];
  }

  get ncuDir() {
    return getNcuDir(this.dir);
  }

  get pullDir() {
    return path.resolve(this.ncuDir, `${this.prid}`);
  }

  getMessagePath(rev) {
    return path.resolve(this.pullDir, `${shortSha(rev)}.COMMIT_EDITMSG`);
  }

  saveMessage(rev, message) {
    const file = this.getMessagePath(rev);
    writeFile(file, message);
    return file;
  }

  async start() {
    const { cli } = this;

    const metadata = await getMetadata({
      prid: this.prid,
      owner: this.owner,
      repo: this.repo
    }, false, cli);
    const expectedCommitShas =
      metadata.data.commits.map(({ commit }) => commit.oid);

    const amend = await cli.prompt(
      'Would you like to amend this PR to the proposal?',
      { default: true }
    );

    if (!amend) {
      return true;
    }

    try {
      const commitInfo = await this.downloadAndPatch(expectedCommitShas);
      const cleanLint = await this.validateLint();
      if (cleanLint === LINT_RESULTS.FAILED) {
        cli.error('Patch still contains lint errors. ' +
          'Please fix manually before proceeding');
        return false;
      } else if (cleanLint === LINT_RESULTS.SUCCESS) {
        cli.ok('Lint passed cleanly');
      }
      return this.amend(metadata.metadata, commitInfo);
    } catch (e) {
      cli.error(e.message);
      return false;
    }
  }

  async downloadAndPatch(expectedCommitShas) {
    const { cli, repo, owner, prid } = this;

    cli.startSpinner(`Downloading patch for ${prid}`);
    // fetch via ssh to handle private repo
    await runAsync('git', [
      'fetch', `git@github.com:${owner}/${repo}.git`,
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
      throw new Error(`Mismatched commits:\n${mismatchedCommits}`);
    }

    const commitInfo = { base, head, shas: commitShas };

    try {
      await forceRunAsync('git', ['cherry-pick', `${base}..${head}`], {
        ignoreFailure: false
      });
    } catch (ex) {
      await forceRunAsync('git', ['cherry-pick', '--abort']);
      throw new Error('Failed to apply patches');
    }

    cli.ok('Patches applied');
    return commitInfo;
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

  async amend(metadata, commitInfo) {
    const { cli } = this;
    const subjects = await runAsync('git',
      ['log', '--pretty=format:%s', `${commitInfo.base}..${commitInfo.head}`],
      { captureStdout: 'lines' });

    if (commitInfo.shas.length !== 1) {
      const fixupAll = await cli.prompt(
        `${subjects.length} commits from the original PR are going to be` +
        'squashed into a single commit. OK to proceed?', {
          defaultAnswer: true
        });
      if (!fixupAll) {
        // TODO: add this support?
        throw new Error(`There are ${subjects.length} commits in the PR ` +
          'and the ammend were not able to succeed');
      }
      await runAsync('git', ['reset', '--soft', `HEAD~${subjects.length - 1}`]);
      await runAsync('git', ['commit', '--amend', '--no-edit']);
    }

    return this._amend(metadata);
  }

  async _amend(metadataStr) {
    const { cli } = this;

    const rev = this.getCurrentRev();
    const original = runSync('git', [
      'show', 'HEAD', '-s', '--format=%B'
    ]).trim();
    // git has very specific rules about what is a trailer and what is not.
    // Instead of trying to implement those ourselves, let git parse the
    // original commit message and see if it outputs any trailers.
    const originalHasTrailers = runSync('git', [
      'interpret-trailers', '--parse', '--no-divider'
    ], {
      input: `${original}\n`
    }).trim().length !== 0;
    const metadata = metadataStr.trim().split('\n');
    const amended = original.split('\n');

    // If the original commit message already contains trailers (such as
    // "Co-authored-by"), we simply add our own metadata after those. Otherwise,
    // we have to add an empty line so that git recognizes our own metadata as
    // trailers in the amended commit message.
    if (!originalHasTrailers) {
      amended.push('');
    }

    const BACKPORT_RE = /BACKPORT-PR-URL\s*:\s*(\S+)/i;
    const PR_RE = /PR-URL\s*:\s*(\S+)/i;
    const REVIEW_RE = /Reviewed-By\s*:\s*(\S+)/i;
    const CVE_RE = /CVE-ID\s*:\s*(\S+)/i;

    let containCVETrailer = false;
    for (const line of metadata) {
      if (line.length !== 0 && original.includes(line)) {
        if (line.match(CVE_RE)) {
          containCVETrailer = true;
        }
        if (originalHasTrailers) {
          cli.warn(`Found ${line}, skipping..`);
        } else {
          throw new Error(
            'Git found no trailers in the original commit message, ' +
            `but '${line}' is present and should be a trailer.`);
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

    if (!containCVETrailer && this.includeCVE) {
      const cveID = await cli.prompt(
        'Git found no CVE-ID trailer in the original commit message. ' +
        'Please, provide the CVE-ID',
        { questionType: 'input', defaultAnswer: 'CVE-2023-XXXXX' }
      );
      amended.push('CVE-ID: ' + cveID);
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
        cli.warn(`Please manually edit ${messageFile}, then run\n` +
          `\`git commit --amend -F ${messageFile}\` ` +
          'to finish amending the message');
        throw new Error(
          'Failed to edit the message using the configured editor');
      }
    }
  }
}
