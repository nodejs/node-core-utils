import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertNewSecurityRelease,
  getSecurityReleaseDraftPath,
  writeSecurityReleaseDraft
} from '../../lib/security-release/draft.js';
import PrepareSecurityRelease from '../../lib/prepare_security.js';

function directory(t) {
  const previous = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncu-security-draft-'));
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

describe('security release draft persistence', () => {
  it('writes a normalized draft only in the explicit repository directory', (t) => {
    const dir = directory(t);
    const file = writeSecurityReleaseDraft(dir, {
      releaseDate: '2026/10/06', reports: [], dependencies: {}
    });
    assert.strictEqual(file, path.join(dir,
      'security-release', 'next-security-release', 'vulnerabilities.json'));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
      releaseDate: '2026-10-06', reports: [], dependencies: {}
    });
    assert.deepStrictEqual(fs.readdirSync(dir), ['security-release']);
  });

  it('preserves an existing draft byte for byte', (t) => {
    const dir = directory(t);
    const draft = { releaseDate: 'TBD', reports: [] };
    const file = writeSecurityReleaseDraft(dir, draft);
    const before = fs.readFileSync(file);
    assert.throws(() => assertNewSecurityRelease(dir), /draft already exists/);
    assert.throws(() => writeSecurityReleaseDraft(dir, {
      releaseDate: '2026-10-06', reports: []
    }), /draft already exists/);
    assert.deepStrictEqual(fs.readFileSync(file), before);
  });

  it('uses exclusive creation even if the file appears after preflight', (t) => {
    const dir = directory(t);
    const file = getSecurityReleaseDraftPath(dir);
    const mkdir = fs.mkdirSync;
    t.mock.method(fs, 'mkdirSync', (...args) => {
      mkdir(...args);
      fs.writeFileSync(file, 'Another session\n');
    });
    assert.throws(() => writeSecurityReleaseDraft(dir, {
      releaseDate: 'TBD', reports: []
    }), { code: 'EEXIST' });
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'Another session\n');
  });

  it('validates inputs before creating directories', (t) => {
    const dir = directory(t);
    assert.throws(() => writeSecurityReleaseDraft(dir, {
      releaseDate: '2026-02-30', reports: []
    }), /Invalid release date/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
    assert.throws(() => getSecurityReleaseDraftPath(), /directory is required/);
  });

  it('does not write a draft when the file-write confirmation is declined', async(t) => {
    const dir = directory(t);
    const previous = process.cwd();
    t.after(() => process.chdir(previous));
    process.chdir(dir);
    let prompts = 0;
    const release = new PrepareSecurityRelease({
      async prompt() {
        return ++prompts === 1;
      }
    });
    await assert.rejects(release.createVulnerabilitiesJSON([], {}, 'TBD'), /Aborted: write/);
    assert.strictEqual(prompts, 2);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});
