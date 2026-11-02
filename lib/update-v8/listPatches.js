import { Listr } from 'listr2';

import { forceRunAsync } from '../run.js';
import updateV8Clone from './updateV8Clone.js';

const IMPORT_PREFIX = 'deps: update V8 to ';
const VERSION_TAG = /^\d+(\.\d+){2,3}$/;
const COLUMNS = ['node_commit', 'kind', 'upstream_ref', 'released_in',
  'backported_to', 'in_target', 'diff', 'subject'];

function git(cwd, args) {
  return forceRunAsync('git', args, {
    ignoreFailure: false,
    captureStdout: true,
    spawnArgs: { cwd, stdio: ['ignore', 'pipe', 'inherit'] }
  }).then((stdout) => stdout.trim());
}

// forceRunAsync resolves to undefined when a command it was allowed to
// ignore fails.
function gitSucceeds(cwd, args) {
  return forceRunAsync('git', args, {
    captureStdout: true,
    spawnArgs: { cwd, stdio: ['ignore', 'pipe', 'ignore'] }
  }).then((stdout) => stdout !== undefined);
}

// Stable patch ID of the diff a git command prints. It ignores whitespace
// and line numbers.
async function patchId(cwd, diffArgs) {
  const diff = await forceRunAsync('git', diffArgs, {
    ignoreFailure: false,
    captureStdout: true,
    spawnArgs: { cwd, stdio: ['ignore', 'pipe', 'inherit'] }
  });
  const id = await forceRunAsync('git', ['patch-id', '--stable'], {
    ignoreFailure: false,
    captureStdout: true,
    input: diff,
    spawnArgs: { cwd, stdio: ['pipe', 'pipe', 'inherit'] }
  });
  return id.split(' ')[0];
}

function lines(output) {
  return output ? output.split('\n') : [];
}

function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? -1) - (y[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

function versionLessThan(a, b) {
  return compareVersions(a, b) < 0;
}

// major.minor of a version.
function lineOf(version) {
  return version.split('.').slice(0, 2).join('.');
}

function firstMatch(text, regexp) {
  return regexp.exec(text)?.[1] ?? null;
}

/**
 * List every V8 patch Node.js carries since its last V8 import. For each one,
 * report the V8 version it first shipped in, the release branches it was
 * merged back to, and whether the target V8 release line contains it.
 * Writes "#" header lines, then one row per patch in commit order, as an
 * aligned table or, with ctx.tsv, tab-separated. See docs/git-node.md for the
 * columns.
 */
export async function listPatches(ctx, write = console.log) {
  if (ctx.target !== undefined && !/^\d+\.\d+$/.test(ctx.target)) {
    throw new Error(`--target must be MAJOR.MINOR, got ${ctx.target}`);
  }
  if (ctx.fetch) {
    await new Listr([updateV8Clone()], { renderer: 'silent' }).run(ctx);
    const [remote, ...branch] = ctx.base.split('/');
    const remotes = lines(await git(ctx.nodeDir, ['remote']));
    if (branch.length && remotes.includes(remote)) {
      await git(ctx.nodeDir, ['fetch', '-q', remote, branch.join('/')]);
    }
  }
  const lister = new PatchLister(ctx, write);
  await lister.init();
  await lister.run();
  lister.render();
}

class PatchLister {
  constructor(ctx, write) {
    this.nodeDir = ctx.nodeDir;
    this.v8Dir = ctx.v8Dir;
    this.base = ctx.base;
    this.target = ctx.target;
    // The bare lkgr ref can point at a different release line.
    this.targetRef = ctx.target && `origin/${ctx.target}-lkgr`;
    this.tsv = ctx.tsv;
    this.checkDiff = ctx.checkDiff;
    this.write = write;
    this.rows = [];
    this.firstVersions = new Map();
  }

  node(...args) {
    return git(this.nodeDir, args);
  }

  v8(...args) {
    return git(this.v8Dir, args);
  }

  async init() {
    let targetHeader;
    if (this.target) {
      const targetSha = await this.v8(
        'rev-parse', '--verify', `${this.targetRef}^{commit}`);
      const versionH = await this.v8(
        'show', `${this.targetRef}:include/v8-version.h`);
      const targetVersion =
        ['MAJOR_VERSION', 'MINOR_VERSION', 'BUILD_NUMBER', 'PATCH_LEVEL']
          .map((name) => firstMatch(versionH, new RegExp(`#define V8_${name} (\\d+)`)))
          .join('.');
      targetHeader =
        `# target: ${this.targetRef} ${targetSha.slice(0, 11)} ${targetVersion}`;
    }

    this.import = await this.node('log', '-1', '--format=%H',
      `--grep=^${IMPORT_PREFIX}`, this.base, '--', 'deps/v8');
    if (!this.import) {
      throw new Error(`No "${IMPORT_PREFIX}" commit found in ${this.base}`);
    }
    const importSubject = await this.node('log', '-1', '--format=%s', this.import);
    this.version = importSubject.slice(IMPORT_PREFIX.length);
    const importLine = lineOf(this.version);

    // Release lines from Node's current one onward, with each line's branch
    // point. Searching only branch-point..lkgr finds merges, not the original.
    const refs = lines(await this.v8('for-each-ref',
      '--format=%(refname:short)', 'refs/remotes/origin/*-lkgr'));
    this.lines = refs
      .map((ref) => firstMatch(ref, /^origin\/(\d+\.\d+)-lkgr$/))
      .filter((line) => line && !versionLessThan(line, importLine))
      .sort(compareVersions);
    this.branchPoints = new Map();
    for (const line of this.lines) {
      this.branchPoints.set(line,
        await this.v8('merge-base', 'origin/main', `origin/${line}-lkgr`));
    }

    const baseShort = await this.node('rev-parse', '--short', this.base);
    this.write(`# import: ${this.import.slice(0, 11)} ${importSubject}`);
    this.write(`# base: ${this.base} ${baseShort}`);
    if (targetHeader) this.write(targetHeader);
    this.write(`# release lines checked for backports: ${this.lines.join(' ')}`);
  }

  async run() {
    const commits = lines(await this.node('log', '--reverse', '--format=%H',
      `${this.import}..${this.base}`, '--', 'deps/v8'));
    for (const commit of commits) {
      const short = commit.slice(0, 11);
      const [subject, body] =
        (await this.node('log', '-1', '--format=%s%x00%b', commit)).split('\0');
      const patchLevel = firstMatch(subject, /^deps: patch V8 to ([0-9.]+)$/);
      if (patchLevel) {
        const ref = this.tsv ? this.version : `${this.version}..${patchLevel}`;
        this.row(short, 'patch-level', ref, '-', '-', '-', '-', subject);
        await this.branchMerges(this.version, patchLevel, commit);
        this.version = patchLevel;
      } else if (/^deps: V8: (cherry-pick|backport) /.test(subject)) {
        const refsLine = body.split('\n').find((l) => /^Refs: .*v8/.test(l));
        const sha = firstMatch(refsLine ?? '', /([0-9a-f]{40})/);
        // The original message is indented under "Original commit message:".
        const origSubject =
          firstMatch(body, /^Original commit message:\n(?:.*\n)?? +(\S.*)$/m);
        const changeId = firstMatch(body, /^ +Change-Id: (I[0-9a-f]+)/m);
        // The Node subject only repeats the SHA in upstream_ref, so the table
        // shows the original V8 subject.
        await this.report(commit, 'cherry-pick', sha?.slice(0, 12) ?? '', sha,
          changeId, origSubject, this.tsv ? subject : (origSubject ?? subject));
      } else {
        this.row(short, 'node-only', '-', '-', '-', 'unknown', '-', subject);
      }
    }
  }

  row(...fields) {
    this.rows.push(fields);
  }

  render() {
    // in_target needs a target, and diff needs checkDiff.
    const hidden = [];
    if (!this.target) hidden.push(COLUMNS.indexOf('in_target'));
    if (!this.checkDiff) hidden.push(COLUMNS.indexOf('diff'));
    const keep = (fields) => fields.filter((_, col) => !hidden.includes(col));
    const columns = keep(COLUMNS);
    const shown = this.rows.map(keep);
    if (this.tsv) {
      this.write('# ' + columns.join('\t'));
      for (const fields of shown) this.write(fields.join('\t'));
      return;
    }
    // Hang each branch-merge row under the patch-level row it came with.
    const rows = shown.map((fields, i) => {
      if (fields[1] !== 'branch-merge') return fields;
      const last = shown[i + 1]?.[1] !== 'branch-merge';
      return [last ? '└─' : '├─', ...fields.slice(1)];
    });
    rows.unshift(columns);
    // The subject is the last column and is left unpadded.
    const widths = columns.slice(0, -1).map(
      (_, col) => Math.max(...rows.map((fields) => fields[col].length)));
    for (const fields of rows) {
      this.write(fields
        .map((field, col) => col < widths.length ? field.padEnd(widths[col]) : field)
        .join('  '));
    }
  }

  hasCommit(sha) {
    return gitSucceeds(this.v8Dir, ['cat-file', '-e', `${sha}^{commit}`]);
  }

  // Earliest V8 version tag containing a commit, or "-".
  async firstVersion(sha) {
    if (!this.firstVersions.has(sha)) {
      const tags = lines(await this.v8('tag', '--contains', sha,
        '--sort=v:refname', '--list', '[0-9]*'));
      this.firstVersions.set(sha, tags.find((t) => VERSION_TAG.test(t)) ?? '-');
    }
    return this.firstVersions.get(sha);
  }

  // First commit on V8 main with exactly this subject.
  async findBySubject(subject) {
    const log = lines(await this.v8('log', '--format=%h%x09%s',
      '--fixed-strings', `--grep=${subject}`, 'origin/main'));
    for (const entry of log) {
      const tab = entry.indexOf('\t');
      if (entry.slice(tab + 1) === subject) return entry.slice(0, tab);
    }
    return null;
  }

  // First commit in a range carrying a Change-Id.
  async findChange(range, changeId) {
    return (await this.v8('log', '-1', '--format=%h', '--fixed-strings',
      `--grep=Change-Id: ${changeId}`, range)) || null;
  }

  // The merge of a change into one release line, searched after the branch
  // point. Gerrit backports usually keep the original Change-Id, but a merge
  // uploaded as a new change gets a new one and only cites the original in
  // its "cherry picked from" line, so check both.
  async findMerge(range, mainSha, changeId) {
    let hit = null;
    if (changeId) {
      hit = await this.findChange(range, changeId);
    }
    if (!hit && mainSha) {
      const full = await this.v8('rev-parse', mainSha);
      hit = (await this.v8('log', '-1', '--format=%h', '--fixed-strings',
        `--grep=cherry picked from commit ${full}`, range)) || null;
    }
    return hit;
  }

  // One row for an upstream change, from its SHA, Change-Id, and original
  // subject. Any of the three may be empty. nodeCommit is a full SHA.
  async report(nodeCommit, kind, ref, sha, changeId, origSubject, subject) {
    let mainSha = null;
    // Whether mainSha is the exact commit Node references.
    let exact = false;
    if (sha && await this.hasCommit(sha)) {
      mainSha = sha;
      exact = true;
    } else if (changeId) {
      mainSha = await this.findChange('origin/main', changeId);
    }
    if (!mainSha && origSubject) {
      // A SHA missing from the clone usually means an unmerged Gerrit CL,
      // which may have landed since under a new SHA.
      mainSha = await this.findBySubject(origSubject);
    }
    let released = '-';
    if (mainSha) {
      released = await this.firstVersion(mainSha);
      if (!changeId) {
        const body = await this.v8('log', '-1', '--format=%b', mainSha);
        changeId = firstMatch(body, /^Change-Id: (I[0-9a-f]+)/m);
      }
    }

    const backports = [];
    let inTarget = null;
    for (const line of this.lines) {
      if (released !== '-') {
        if (!versionLessThan(line, lineOf(released))) continue;
      } else if (this.target && versionLessThan(this.target, line)) {
        continue;
      }
      const range = `${this.branchPoints.get(line)}..origin/${line}-lkgr`;
      const hit = await this.findMerge(range, mainSha, changeId);
      if (!hit) continue;
      // The version names the line, and the target line's SHA is in
      // in_target, so the table shows only the version.
      const version = await this.firstVersion(hit);
      backports.push(this.tsv ? `${line}:${hit}@${version}` : version);
      if (line === this.target) inTarget = `merged:${hit}`;
    }

    if (this.target && !inTarget) {
      if (mainSha && await gitSucceeds(this.v8Dir,
        ['merge-base', '--is-ancestor', mainSha, this.targetRef])) {
        inTarget = exact ? 'ancestor' : `merged:${mainSha}`;
      } else if (exact) {
        inTarget = 'missing';
      } else if (mainSha) {
        inTarget = `missing:${mainSha}`;
      } else {
        inTarget = 'unknown';
      }
    }
    // A branch-merge row's node commit is its whole patch-level update, so
    // only cherry-picks have a Node diff to compare. Node is usually on an
    // older V8 than main, so the diffs omit context lines, which can differ
    // even when the pick is unchanged.
    let diff = '-';
    if (this.checkDiff && kind === 'cherry-pick' && mainSha) {
      const nodeId = await patchId(this.nodeDir, ['diff-tree', '-p', '-U0',
        '--no-commit-id', '--relative=deps/v8/', nodeCommit]);
      const v8Id = await patchId(this.v8Dir,
        ['diff-tree', '-p', '-U0', '--no-commit-id', mainSha]);
      diff = nodeId === v8Id ? 'same' : 'differs';
    }
    this.row(nodeCommit.slice(0, 11), kind, ref, released,
      backports.join(this.tsv ? ',' : ', ') || '-',
      inTarget, diff, subject);
  }

  // Rows for the fixes merged into the V8 release branch from version
  // `from` to `to`. Patch updates take the newest version tag, which can be
  // ahead of the line's lkgr, so resolve the tags rather than search lkgr.
  async branchMerges(from, to, nodeCommit) {
    const vFrom = `refs/tags/${from}`;
    const vTo = `refs/tags/${to}`;
    if (!await this.hasCommit(vFrom) || !await this.hasCommit(vTo)) {
      this.row(nodeCommit.slice(0, 11), 'branch-merge', '-', '-', '-',
        'unknown', '-', `Tag ${from} or ${to} not found`);
      return;
    }
    const shas = lines(await this.v8('log', '--reverse', '--first-parent',
      '--format=%H', `${vFrom}..${vTo}`));
    for (const sha of shas) {
      const [subject, body] =
        (await this.v8('log', '-1', '--format=%s%x00%b', sha)).split('\0');
      if (subject.startsWith('Version ')) continue;
      const orig = firstMatch(body, /cherry picked from commit ([0-9a-f]{40})/);
      const changeId = firstMatch(body, /^Change-Id: (I[0-9a-f]+)/m);
      await this.report(nodeCommit, 'branch-merge', sha.slice(0, 12), orig,
        changeId, null, subject);
    }
  }
}
