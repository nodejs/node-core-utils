import path from 'node:path';
import { promises as fs } from 'node:fs';

import { execa } from 'execa';
import { Listr } from 'listr2';

import { getCurrentV8Version } from './common.js';
import {
  getNodeV8Version,
  filterForVersion,
  addToGitignore,
  replaceGitignore,
  removeDirectory
} from './util.js';
import applyNodeChanges from './applyNodeChanges.js';
import { chromiumGit, v8Deps } from './constants.js';

export default function majorUpdate() {
  return {
    title: 'Major V8 update',
    task: () => {
      return new Listr([
        getCurrentV8Version(),
        checkoutBranch(),
        removeDepsV8(),
        cloneLocalV8(),
        removeDepsV8Git(),
        addDepsV8(),
        updateV8Deps(),
        applyNodeChanges()
      ]);
    }
  };
};

const versionReg = /^\d+(\.\d+)+$/;
function checkoutBranch() {
  return {
    title: 'Checkout V8 branch',
    task: async(ctx) => {
      let version = ctx.branch;
      await ctx.execGitV8('checkout', 'origin/main');
      if (!versionReg.test(version)) {
        // try to get the latest tag
        const res = await ctx.execGitV8(
          'tag',
          '--contains',
          `origin/${version}`,
          '--sort',
          'version:refname'
        );
        const tags = res.stdout.split('\n');
        const lastTag = tags[tags.length - 1];
        if (lastTag) version = lastTag;
        if (version.split('.').length === 3) {
          // Prerelease versions are branched and 'lkgr' does not include
          // the version commit
          ctx.branch = version;
        }
      }
      if (version === ctx.currentVersion.toString()) {
        throw new Error(`Current version is already ${version}`);
      }
      ctx.newVersion = version.split('.').map((s) => parseInt(s, 10));
      try {
        await ctx.execGitV8('branch', '-D', ctx.branch);
      } catch (e) {
        // ignore
      }
      await ctx.execGitV8('branch', ctx.branch, `origin/${ctx.branch}`);
    }
  };
}

function removeDepsV8() {
  return {
    title: 'Remove deps/v8',
    task: (ctx) => removeDirectory(path.join(ctx.nodeDir, 'deps/v8'))
  };
}

function cloneLocalV8() {
  return {
    title: 'Clone branch to deps/v8',
    task: (ctx) =>
      execa('git', ['clone', '-b', ctx.branch, ctx.v8Dir, 'deps/v8'], {
        cwd: ctx.nodeDir
      })
  };
}

function removeDepsV8Git() {
  return {
    title: 'Remove deps/v8/.git',
    task: (ctx) => removeDirectory(path.join(ctx.nodeDir, 'deps/v8/.git'))
  };
}

function addDepsV8() {
  return {
    title: 'Track all files in deps/v8',
    // Add all V8 files with --force before updating DEPS. We have to do this
    // because some files are checked in by V8 despite .gitignore rules.
    task: (ctx) => execa('git', ['add', '--force', 'deps/v8'], {
      cwd: ctx.nodeDir
    })
  };
}

function updateV8Deps() {
  return {
    title: 'Update V8 DEPS',
    task: async(ctx) => {
      const newV8Version = await getNodeV8Version(ctx.nodeDir);
      const repoPrefix = newV8Version.majorMinor >= 86 ? '' : 'v8/';
      const deps = filterForVersion(v8Deps.map((v8Dep) => ({
        ...v8Dep,
        repo: `${repoPrefix}${v8Dep.repo}`,
        path: v8Dep.repo
      })), newV8Version);
      if (deps.length === 0) return;
      /* eslint-disable no-await-in-loop */
      for (const dep of deps) {
        if (dep.gitignore) {
          if (typeof dep.gitignore === 'string') {
            await addToGitignore(ctx.nodeDir, dep.gitignore);
          } else {
            await replaceGitignore(ctx.nodeDir, dep.gitignore);
          }
        }
        const [repo, commit] = await readDeps(ctx.nodeDir, dep.repo);
        const thePath = path.join(ctx.nodeDir, 'deps/v8', dep.path);
        await fetchFromGit(thePath, repo, commit);
      }
      /* eslint-enable */
    }
  };
}

async function readDeps(nodeDir, depName) {
  const depsStr = await fs.readFile(path.join(nodeDir, 'deps/v8/DEPS'), 'utf8');
  const start = depsStr.indexOf('deps = {');
  const end = depsStr.indexOf('\n}', start) + 2;
  const depsDeclaration = depsStr.substring(start, end).replace(/^ *#.*/gm, '');
  const Var = () => chromiumGit; // eslint-disable-line no-unused-vars
  let deps;
  eval(depsDeclaration); // eslint-disable-line no-eval
  const dep = deps[depName];
  if (typeof dep === 'object') {
    return dep.url.split('@');
  }
  return dep.split('@');
}

async function fetchFromGit(cwd, repo, commit) {
  await fs.mkdir(cwd, { recursive: true });
  await exec('init');
  await exec('remote', 'add', 'origin', repo);
  await exec('fetch', 'origin', commit);
  await exec('reset', '--hard', 'FETCH_HEAD');
  await removeDirectory(path.join(cwd, '.git'));

  function exec(...options) {
    return execa('git', options, { cwd });
  }
}
