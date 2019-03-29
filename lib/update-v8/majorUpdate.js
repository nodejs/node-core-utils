'use strict';

const path = require('path');

const execa = require('execa');
const fs = require('fs-extra');
const Listr = require('listr');
const mkdirp = require('mkdirp');

const common = require('./common');
const {
  getNodeV8Version,
  filterForVersion,
  addToGitignore,
  replaceGitignore
} = require('./util');
const applyNodeChanges = require('./applyNodeChanges');
const { chromiumGit, v8Deps } = require('./constants');

module.exports = function() {
  return {
    title: 'Major V8 update',
    task: () => {
      return new Listr([
        common.getCurrentV8Version(),
        checkoutBranch(),
        removeDepsV8(),
        cloneLocalV8(),
        removeDepsV8Git(),
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
      await ctx.execGitV8('checkout', 'origin/master');
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
      if (version === ctx.currentVersion.join('.')) {
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
    task: (ctx) => fs.remove(path.join(ctx.nodeDir, 'deps/v8'))
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
    task: (ctx) => fs.remove(path.join(ctx.nodeDir, 'deps/v8/.git'))
  };
}

function updateV8Deps() {
  return {
    title: 'Update V8 DEPS',
    task: async(ctx) => {
      const newV8Version = getNodeV8Version(ctx.nodeDir);
      const deps = filterForVersion(v8Deps, newV8Version);
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
  return dep.split('@');
}

async function fetchFromGit(cwd, repo, commit) {
  mkdirp.sync(cwd);
  await exec('init');
  await exec('remote', 'add', 'origin', repo);
  await exec('fetch', 'origin', commit);
  await exec('reset', '--hard', 'FETCH_HEAD');
  await fs.remove(path.join(cwd, '.git'));

  function exec(...options) {
    return execa('git', options, { cwd });
  }
}
