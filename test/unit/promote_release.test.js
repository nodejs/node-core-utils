import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import ReleasePromotion from '../../lib/promote_release.js';
import { updateNodeVersionForNextRelease } from '../../lib/release/utils.js';

const today = new Date().toISOString().slice(0, 10);

function releasePromotion() {
  const errors = [];
  const release = Object.assign(Object.create(ReleasePromotion.prototype), {
    gpgSign: [],
    cli: {
      error: (message) => errors.push(message),
      warn: () => {},
      info: () => {},
      separator: () => {},
      prompt: async() => false
    }
  });
  return { release, errors };
}

describe('promote_release: validateReleaseCommit', () => {
  it('parses an Alpha release commit', async() => {
    const { release } = releasePromotion();
    assert.deepStrictEqual(
      await release.validateReleaseCommit(`${today}, Version 27.0.0-alpha.0.0.0 (Alpha)`),
      {
        date: today,
        version: '27.0.0-alpha.0.0.0',
        stagingBranch: 'v27.x-staging',
        versionComponents: { major: 27, minor: 0, patch: 0 },
        alphaVersionComponents: { major: 0, minor: 0, patch: 0 },
        isAlpha: true
      }
    );
  });

  it('parses Current and LTS release commits', async() => {
    const { release } = releasePromotion();
    const current = await release.validateReleaseCommit(`${today}, Version 26.12.1 (Current)`);
    assert.strictEqual(current.version, '26.12.1');
    assert.strictEqual(current.alphaVersionComponents, null);
    assert.strictEqual(current.isAlpha, undefined);
    assert.strictEqual(current.isLTS, undefined);

    const lts = await release.validateReleaseCommit(`${today}, Version 24.11.0 'Krypton' (LTS)`);
    assert.strictEqual(lts.version, '24.11.0');
    assert.strictEqual(lts.isAlpha, undefined);
    assert.strictEqual(lts.isLTS, true);
    assert.strictEqual(lts.ltsCodename, 'Krypton');
  });

  it('rejects mismatched Alpha versions and release types', async() => {
    for (const title of [
      `${today}, Version 27.0.0 (Alpha)`,
      `${today}, Version 27.0.0-alpha.1 (Alpha)`,
      `${today}, Version 27.0.0-alpha.0.0.0 (Current)`,
      `${today}, Version 27.0.0-alpha.0.0.0 'Krypton' (LTS)`
    ]) {
      const { release, errors } = releasePromotion();
      await assert.rejects(release.validateReleaseCommit(title), /Aborted/, title);
      assert.strictEqual(errors.length, 1, title);
    }
  });
});

describe('promote_release: updateNodeVersionForNextRelease', () => {
  const header = (patch, isRelease, alphaPatch) => [
    '#define NODE_MAJOR_VERSION 27',
    '#define NODE_MINOR_VERSION 0',
    `#define NODE_PATCH_VERSION ${patch}`,
    '',
    `#define NODE_VERSION_IS_RELEASE ${isRelease}`,
    '',
    '#define NODE_ALPHA_MAJOR_VERSION 1',
    '#define NODE_ALPHA_MINOR_VERSION 0',
    `#define NODE_ALPHA_PATCH_VERSION ${alphaPatch}`,
    ''
  ].join('\n');

  it('bumps NODE_ALPHA_PATCH_VERSION for Alpha releases', () => {
    assert.strictEqual(
      updateNodeVersionForNextRelease(header(0, 1, 9), {
        versionComponents: { major: 27, minor: 0, patch: 0 },
        alphaVersionComponents: { major: 1, minor: 0, patch: 9 }
      }),
      header(0, 0, 10)
    );
  });

  it('bumps NODE_PATCH_VERSION for other releases', () => {
    const current = [
      '#define NODE_MAJOR_VERSION 26',
      '#define NODE_MINOR_VERSION 12',
      '#define NODE_PATCH_VERSION 9',
      '',
      '#define NODE_VERSION_IS_RELEASE 1',
      ''
    ].join('\n');
    assert.strictEqual(
      updateNodeVersionForNextRelease(current, {
        versionComponents: { major: 26, minor: 12, patch: 9 }
      }),
      current
        .replace('NODE_PATCH_VERSION 9', 'NODE_PATCH_VERSION 10')
        .replace('NODE_VERSION_IS_RELEASE 1', 'NODE_VERSION_IS_RELEASE 0')
    );
  });
});

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function nodeVersionH(major, isRelease, alpha) {
  return [
    `#define NODE_MAJOR_VERSION ${major}`,
    '#define NODE_MINOR_VERSION 0',
    '#define NODE_PATCH_VERSION 0',
    '',
    `#define NODE_VERSION_IS_RELEASE ${isRelease}`,
    '',
    ...(alpha
      ? [
          `#define NODE_ALPHA_MAJOR_VERSION ${alpha[0]}`,
          `#define NODE_ALPHA_MINOR_VERSION ${alpha[1]}`,
          `#define NODE_ALPHA_PATCH_VERSION ${alpha[2]}`,
          ''
        ]
      : []),
    '#ifndef NODE_STRINGIFY',
    ''
  ].join('\n');
}

function repository(t, releaseTitle, releaseNodeVersionH) {
  const previous = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ncu-promote-release-'));
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
  fs.mkdirSync('src');
  fs.writeFileSync('src/node_version.h', nodeVersionH(27, 0, [0, 0, 0]));
  fs.writeFileSync('CHANGELOG.md', '# Changelog\n');
  git('add', '.');
  git('commit', '-m', 'Initial commit');
  git('checkout', '-b', 'v27.x');
  fs.writeFileSync('src/node_version.h', releaseNodeVersionH);
  fs.writeFileSync('CHANGELOG.md', `# Changelog\n\n${releaseTitle}\n`);
  git('commit', '-am', releaseTitle);
  const releaseCommitSha = git('rev-parse', 'HEAD');
  git('checkout', 'main');
  return releaseCommitSha;
}

describe('promote_release: cherryPickReleaseCommit', { concurrency: false }, () => {
  const keepsNodeVersionH = async(t, version, releaseInfo, header) => {
    const title = `${today}, Version ${version} ${releaseInfo}`;
    const sha = repository(t, title, header);
    const { release } = releasePromotion();
    await release.cherryPickReleaseCommit(sha, {
      version, versionComponents: { major: 27, minor: 0, patch: 0 }
    });
    assert.strictEqual(git('log', '-1', '--format=%s'), title);
    assert.strictEqual(git('show', '--format=', '--name-only', 'HEAD'), 'CHANGELOG.md');
    assert.strictEqual(
      fs.readFileSync('src/node_version.h', 'utf8'), nodeVersionH(27, 0, [0, 0, 0]));
  };

  it('keeps node_version.h of the default branch for Alpha releases', (t) =>
    keepsNodeVersionH(t, '27.0.0-alpha.1.0.0', '(Alpha)', nodeVersionH(27, 1, [1, 0, 0])));

  it('keeps node_version.h of the default branch for the major release', (t) =>
    keepsNodeVersionH(t, '27.0.0', '(Current)', nodeVersionH(27, 1)));

  it('moves the default branch to the next major after the first Alpha release', async(t) => {
    const title = `${today}, Version 27.0.0-alpha.0.0.0 (Alpha)`;
    const sha = repository(t, title, nodeVersionH(27, 1, [0, 0, 0]));
    const { release } = releasePromotion();
    await release.cherryPickReleaseCommit(sha, {
      version: '27.0.0-alpha.0.0.0', versionComponents: { major: 27, minor: 0, patch: 0 }
    });
    assert.strictEqual(git('log', '-1', '--format=%s'), title);
    assert.strictEqual(
      git('show', '--format=', '--name-only', 'HEAD'), 'CHANGELOG.md\nsrc/node_version.h');
    assert.strictEqual(
      fs.readFileSync('src/node_version.h', 'utf8'), nodeVersionH(28, 0, [0, 0, 0]));
  });
});
