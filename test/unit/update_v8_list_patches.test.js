import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { listPatches } from '../../lib/update-v8/listPatches.js';

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function init(dir) {
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test User');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
}

function commit(dir, message, files = {}) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
    git(dir, 'add', file);
  }
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function versionCommit(dir, version) {
  const [major, minor, build, patch = 0] = version.split('.');
  const sha = commit(dir, `Version ${version}`, {
    'include/v8-version.h':
      `#define V8_MAJOR_VERSION ${major}\n#define V8_MINOR_VERSION ${minor}\n` +
      `#define V8_BUILD_NUMBER ${build}\n#define V8_PATCH_LEVEL ${patch}\n`
  });
  git(dir, 'tag', version);
  return sha;
}

function short(dir, sha) {
  return git(dir, 'rev-parse', '--short', sha);
}

const C_BEFORE = '1\n2\n3\nOLD\n5\n6\n';

// V8 main runs 1.1 -> 1.4. Release lines 1.1 and 1.3 carry merged fixes.
// The 1.1 lkgr stops before the latest 1.1 tag.
function createV8(dir) {
  init(dir);
  const v8 = {};
  commit(dir, 'Add C', { 'src/c.cc': C_BEFORE });
  versionCommit(dir, '1.1.0');
  v8.fixA = commit(dir, 'Fix A\n\nChange-Id: Iaaaa');
  versionCommit(dir, '1.2.0');
  v8.fixB = commit(dir, 'Fix B\n\nChange-Id: Ibbbb');
  versionCommit(dir, '1.3.0');
  // Changes the context of Fix C, which Node's older V8 lacks.
  commit(dir, 'Tweak C', { 'src/c.cc': C_BEFORE.replace('2', 'two') });
  v8.fixC = commit(dir, 'Fix C\n\nChange-Id: Icccc',
    { 'src/c.cc': C_BEFORE.replace('2', 'two').replace('OLD', 'NEW') });
  versionCommit(dir, '1.4.0');
  v8.fixD = commit(dir, 'Fix D\n\nChange-Id: Idddd');
  v8.fixE = commit(dir, 'Fix E\n\nChange-Id: Ieeee', { 'src/e.cc': 'E\n' });
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

  git(dir, 'switch', '-q', '-c', 'release-1.1', '1.1.0');
  v8.mergeA = commit(dir,
    `[M11] Fix A\n\nChange-Id: Iaaaa\n(cherry picked from commit ${v8.fixA})`);
  versionCommit(dir, '1.1.1');
  git(dir, 'update-ref', 'refs/remotes/origin/1.1-lkgr', 'HEAD');
  v8.mergeD = commit(dir,
    `[M11] Fix D\n\nChange-Id: Id111\n(cherry picked from commit ${v8.fixD})`);
  versionCommit(dir, '1.1.2');

  git(dir, 'update-ref', 'refs/remotes/origin/1.2-lkgr', '1.2.0');

  git(dir, 'switch', '-q', '-c', 'release-1.3', '1.3.0');
  v8.mergeC = commit(dir,
    `[M13] Fix C\n\nChange-Id: Ic333\n(cherry picked from commit ${v8.fixC})`);
  versionCommit(dir, '1.3.1');
  git(dir, 'update-ref', 'refs/remotes/origin/1.3-lkgr', 'HEAD');
  git(dir, 'update-ref', 'refs/remotes/origin/1.4-lkgr', '1.4.0');
  return v8;
}

function cherryPick(sha, subject) {
  return `deps: V8: cherry-pick ${sha.slice(0, 12)}\n\n` +
    `Original commit message:\n\n    ${subject}\n\n    Change-Id: Ifake\n\n` +
    `Refs: https://github.com/v8/v8/commit/${sha}`;
}

function createNode(dir, v8) {
  init(dir);
  let n = 0;
  const touch = (message) => commit(dir, message, { 'deps/v8/file': `${n++}` });
  const node = {};
  node.import = commit(dir, 'deps: update V8 to 1.1.0',
    { 'deps/v8/file': `${n++}`, 'deps/v8/src/c.cc': C_BEFORE });
  node.patch = touch('deps: patch V8 to 1.1.2');
  // The same change as upstream with different context, plus the embedder
  // string bump outside deps/v8.
  node.pickC = commit(dir, cherryPick(v8.fixC, 'Fix C'),
    { 'deps/v8/src/c.cc': C_BEFORE.replace('OLD', 'NEW'), 'common.gypi': '1\n' });
  // Edited while picking.
  node.pickE = commit(dir, cherryPick(v8.fixE, 'Fix E'),
    { 'deps/v8/src/e.cc': 'E edited\n' });
  // A Gerrit SHA that never landed under that SHA.
  node.pickB = touch(cherryPick('f'.repeat(40), 'Fix B'));
  node.pickX = touch(cherryPick('e'.repeat(40), 'Fix X'));
  node.local = touch('deps: fix V8 build on some platform');
  return node;
}

describe('git node v8 list-patches', () => {
  let root, v8Dir, nodeDir, v8, node;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncu-v8-patches-'));
    v8Dir = path.join(root, 'v8');
    nodeDir = path.join(root, 'node');
    v8 = createV8(v8Dir);
    node = createNode(nodeDir, v8);
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  async function run(options) {
    const output = [];
    await listPatches({
      nodeDir, v8Dir, base: 'main', target: '1.3', fetch: false, ...options
    }, (line) => output.push(line));
    return output;
  }

  function preamble() {
    const targetSha = git(v8Dir, 'rev-parse', 'origin/1.3-lkgr').slice(0, 11);
    return [
      `# import: ${node.import.slice(0, 11)} deps: update V8 to 1.1.0`,
      `# base: main ${short(nodeDir, 'main')}`,
      `# target: origin/1.3-lkgr ${targetSha} 1.3.1.0`,
      '# release lines checked for backports: 1.1 1.2 1.3 1.4'
    ];
  }

  it('reports each patch and whether the target line contains it', async() => {
    const output = await run({ tsv: true });

    const s = (sha) => short(v8Dir, sha);
    const n = (sha) => sha.slice(0, 11);
    assert.deepStrictEqual(output, [
      ...preamble(),
      '# node_commit\tkind\tupstream_ref\treleased_in\tbackported_to\t' +
        'in_target\tsubject',
      `${n(node.patch)}\tpatch-level\t1.1.0\t-\t-\t-\tdeps: patch V8 to 1.1.2`,
      `${n(node.patch)}\tbranch-merge\t${v8.mergeA.slice(0, 12)}\t1.2.0\t` +
        `1.1:${s(v8.mergeA)}@1.1.1\tancestor\t[M11] Fix A`,
      // Backports are searched up to lkgr, which this merge is past.
      `${n(node.patch)}\tbranch-merge\t${v8.mergeD.slice(0, 12)}\t-\t-\tmissing\t` +
        '[M11] Fix D',
      `${n(node.pickC)}\tcherry-pick\t${v8.fixC.slice(0, 12)}\t1.4.0\t` +
        `1.3:${s(v8.mergeC)}@1.3.1\tmerged:${s(v8.mergeC)}\t` +
        `deps: V8: cherry-pick ${v8.fixC.slice(0, 12)}`,
      `${n(node.pickE)}\tcherry-pick\t${v8.fixE.slice(0, 12)}\t-\t-\tmissing\t` +
        `deps: V8: cherry-pick ${v8.fixE.slice(0, 12)}`,
      `${n(node.pickB)}\tcherry-pick\t${'f'.repeat(12)}\t1.3.0\t-\t` +
        `merged:${s(v8.fixB)}\tdeps: V8: cherry-pick ${'f'.repeat(12)}`,
      `${n(node.pickX)}\tcherry-pick\t${'e'.repeat(12)}\t-\t-\tunknown\t` +
        `deps: V8: cherry-pick ${'e'.repeat(12)}`,
      `${n(node.local)}\tnode-only\t-\t-\t-\tunknown\t` +
        'deps: fix V8 build on some platform'
    ]);
  });

  it('omits the target header and in_target column without --target', async() => {
    const output = await run({ tsv: true, target: undefined });

    // No fix in this fixture is merged into a line newer than 1.3, so the
    // rows match the --target 1.3 rows minus in_target.
    const withTarget = await run({ tsv: true });
    const expected = withTarget
      .filter((line) => !line.startsWith('# target:'))
      .map((line) => line.split('\t').toSpliced(5, 1).join('\t'));
    assert.deepStrictEqual(output, expected);
    assert.strictEqual(output[3],
      '# node_commit\tkind\tupstream_ref\treleased_in\tbackported_to\tsubject');
  });

  it('compares each cherry-pick diff with upstream with --check-diff', async() => {
    const output = await run({ tsv: true, checkDiff: true });

    const header = output[preamble().length].split('\t');
    assert.deepStrictEqual(header.slice(-3), ['in_target', 'diff', 'subject']);
    const diffs = output.slice(preamble().length + 1).map((line) => {
      const fields = line.split('\t');
      return [fields[0], fields[1], fields.at(-2)];
    });
    const n = (sha) => sha.slice(0, 11);
    assert.deepStrictEqual(diffs, [
      [n(node.patch), 'patch-level', '-'],
      [n(node.patch), 'branch-merge', '-'],
      [n(node.patch), 'branch-merge', '-'],
      [n(node.pickC), 'cherry-pick', 'same'],
      [n(node.pickE), 'cherry-pick', 'differs'],
      // Compared against the commit found by subject, which is empty.
      [n(node.pickB), 'cherry-pick', 'differs'],
      [n(node.pickX), 'cherry-pick', '-'],
      [n(node.local), 'node-only', '-']
    ]);

    const table = await run({ tsv: false, checkDiff: true });
    assert.deepStrictEqual(table[preamble().length].split(/ {2,}/).slice(-3),
      ['in_target', 'diff', 'subject']);
  });

  it('aligns the table and hangs branch merges under their update', async() => {
    const output = await run({ tsv: false });

    const table = output.slice(preamble().length);
    assert.deepStrictEqual(output.slice(0, preamble().length), preamble());
    // Columns are separated by at least two spaces.
    assert.deepStrictEqual(table.map((line) => line.split(/ {2,}/).slice(0, 5)), [
      ['node_commit', 'kind', 'upstream_ref', 'released_in', 'backported_to'],
      [node.patch.slice(0, 11), 'patch-level', '1.1.0..1.1.2', '-', '-'],
      ['├─', 'branch-merge', v8.mergeA.slice(0, 12), '1.2.0', '1.1.1'],
      ['└─', 'branch-merge', v8.mergeD.slice(0, 12), '-', '-'],
      [node.pickC.slice(0, 11), 'cherry-pick', v8.fixC.slice(0, 12), '1.4.0',
        '1.3.1'],
      [node.pickE.slice(0, 11), 'cherry-pick', v8.fixE.slice(0, 12), '-', '-'],
      [node.pickB.slice(0, 11), 'cherry-pick', 'f'.repeat(12), '1.3.0', '-'],
      [node.pickX.slice(0, 11), 'cherry-pick', 'e'.repeat(12), '-', '-'],
      [node.local.slice(0, 11), 'node-only', '-', '-', '-']
    ]);
    // Cherry-picks show the original V8 subject.
    const subjects = ['subject', 'deps: patch V8 to 1.1.2', '[M11] Fix A',
      '[M11] Fix D', 'Fix C', 'Fix E', 'Fix B', 'Fix X',
      'deps: fix V8 build on some platform'];
    assert.deepStrictEqual(
      table.map((line, i) => line.endsWith(`  ${subjects[i]}`)),
      subjects.map(() => true));
    const offsets = subjects.map((subject, i) => table[i].indexOf(subject));
    assert.deepStrictEqual(offsets, offsets.map(() => offsets[0]));
  });

  it('rejects a target that is not MAJOR.MINOR', async() => {
    await assert.rejects(listPatches({ target: '1.3.0', fetch: false }),
      /--target must be MAJOR\.MINOR/);
  });
});
