import path from 'node:path';
import { getMetadata } from '../components/metadata.js';

import {
  runAsync, runSync
} from './run.js';
import { getNcuDir } from './config.js';
import LandingSession, { LINT_RESULTS } from './landing_session.js';

export default class CherryPick {
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

    return LandingSession.prototype.amend.call(this, metadata);
  }

  readyToAmend() {
    return true;
  }

  startAmending() {
    // No-op
  }
}

CherryPick.prototype.downloadAndPatch = LandingSession.prototype.downloadAndPatch;
CherryPick.prototype.validateLint = LandingSession.prototype.validateLint;
CherryPick.prototype.getMessagePath = LandingSession.prototype.getMessagePath;
CherryPick.prototype.saveMessage = LandingSession.prototype.saveMessage;
