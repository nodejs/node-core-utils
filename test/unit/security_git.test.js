import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import PrepareSecurityRelease from '../../lib/prepare_security.js';

import {
  checkoutOnSecurityReleaseBranch,
  stageSecurityReleaseChanges,
  NEXT_SECURITY_RELEASE_REPOSITORY
} from '../../lib/security-release/security-release.js';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repository(t) {
  const previous = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ncu-security-git-'));
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  process.chdir(directory);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test User');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', path.join(directory, 'no-hooks'));
  git('commit', '--allow-empty', '-m', 'Initial commit');
  git('remote', 'add', 'origin', 'https://github.com/nodejs-private/security-release.git');
  return directory;
}

const cli = { info() {}, ok() {}, log() {}, prompt: async() => true };

describe('security release git state', { concurrency: false }, () => {
  it('creates a new release branch from the current HEAD', async(t) => {
    repository(t);
    const head = git('rev-parse', 'HEAD');
    await checkoutOnSecurityReleaseBranch(cli, NEXT_SECURITY_RELEASE_REPOSITORY);
    assert.strictEqual(git('branch', '--show-current'), 'next-security-release');
    assert.strictEqual(git('rev-parse', 'HEAD'), head);
  });

  it('checks out an existing release branch without resetting it', async(t) => {
    repository(t);
    const releaseHead = git('rev-parse', 'HEAD');
    git('branch', 'next-security-release');
    git('commit', '--allow-empty', '-m', 'Unrelated work');
    assert.notStrictEqual(git('rev-parse', 'HEAD'), releaseHead);

    await checkoutOnSecurityReleaseBranch(cli, NEXT_SECURITY_RELEASE_REPOSITORY);

    assert.strictEqual(git('branch', '--show-current'), 'next-security-release');
    assert.strictEqual(git('rev-parse', 'HEAD'), releaseHead);
  });

  it('starts from an existing remote-tracking release branch', async(t) => {
    repository(t);
    const releaseHead = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/next-security-release', releaseHead);
    git('commit', '--allow-empty', '-m', 'Unrelated work');

    await checkoutOnSecurityReleaseBranch(cli, NEXT_SECURITY_RELEASE_REPOSITORY);

    assert.strictEqual(git('rev-parse', 'HEAD'), releaseHead);
    assert.strictEqual(
      git('rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/next-security-release');
  });

  it('rejects unrelated staged work before staging the release file', async(t) => {
    repository(t);
    fs.writeFileSync('unrelated notes.txt', 'User work\n');
    git('add', 'unrelated notes.txt');
    fs.writeFileSync('vulnerabilities.json', '{}\n');
    const index = git('write-tree');
    const head = git('rev-parse', 'HEAD');
    await assert.rejects(stageSecurityReleaseChanges(
      'vulnerabilities.json', 'Prepare release',
      { cli, repository: NEXT_SECURITY_RELEASE_REPOSITORY }
    ), /Unrelated staged changes/);
    assert.strictEqual(git('write-tree'), index);
    assert.strictEqual(git('rev-parse', 'HEAD'), head);
    assert.strictEqual(fs.readFileSync('unrelated notes.txt', 'utf8'), 'User work\n');
  });

  it('stages release files with a pre-filled commit message', async(t) => {
    repository(t);
    fs.mkdirSync('security-release');
    fs.writeFileSync('security-release/vulnerabilities.json', '{}\n');
    git('add', 'security-release/vulnerabilities.json');
    fs.writeFileSync('security-release/notes.md', 'Notes\n');
    const head = git('rev-parse', 'HEAD');
    await stageSecurityReleaseChanges(
      'security-release', 'Prepare release', {
        cli: { ...cli, prompt: async() => assert.fail('Staging must not prompt') },
        repository: NEXT_SECURITY_RELEASE_REPOSITORY
      }
    );
    assert.strictEqual(git('rev-parse', 'HEAD'), head);
    assert.strictEqual(git('diff', '--cached', '--name-only'),
      'security-release/notes.md\nsecurity-release/vulnerabilities.json');
    const messagePath = git('rev-parse', '--git-path', 'MERGE_MSG');
    assert.strictEqual(fs.readFileSync(messagePath, 'utf8'), 'Prepare release\n');

    fs.writeFileSync('security-release/vulnerabilities.json', '[]\n');
    await stageSecurityReleaseChanges(
      'security-release', 'Update release', {
        cli, repository: NEXT_SECURITY_RELEASE_REPOSITORY
      }
    );
    assert.strictEqual(fs.readFileSync(messagePath, 'utf8'),
      'Prepare release\nUpdate release\n');
  });

  it('preserves Git state if draft preparation fails', async(t) => {
    repository(t);
    const release = new PrepareSecurityRelease(cli);
    release.chooseReports = async() => [];
    release.getDependencyUpdates = async() => {
      throw new Error('Preparation interrupted');
    };
    await assert.rejects(
      release.startVulnerabilitiesJSONCreation('TBD', 'Release'), /Preparation interrupted/);
    assert.strictEqual(git('branch', '--show-current'), 'main');
    assert.strictEqual(git('branch', '--list', 'next-security-release'), '');
    assert.strictEqual(git('status', '--porcelain'), '');
  });
});
