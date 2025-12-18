import path from 'node:path';

import { getCurrentV8Version } from './common.js';
import updateV8Deps from './deps.js';
import {
  removeDirectory,
  isVersionString
} from './util.js';
import applyNodeChanges from './applyNodeChanges.js';
import { forceRunAsync } from '../run.js';

export default function majorUpdate() {
  return {
    title: 'Major V8 update',
    task: (ctx, task) => {
      return task.newListr([
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

function checkoutBranch() {
  return {
    title: 'Checkout V8 branch',
    task: async(ctx) => {
      let version = ctx.branch;
      await ctx.execGitV8('checkout', 'origin/main');
      if (!isVersionString(version)) {
        // try to get the latest tag
        const res = await ctx.execGitV8(
          'tag',
          '--contains',
          `origin/${version}`,
          '--sort',
          'version:refname'
        );
        const tags = res.split('\n').filter(isVersionString);
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
      forceRunAsync('git', ['clone', '-b', ctx.branch, ctx.v8Dir, 'deps/v8'], {
        ignoreFailure: false,
        spawnArgs: { cwd: ctx.nodeDir, stdio: 'ignore' }
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
    task: (ctx) => forceRunAsync('git', ['add', '--force', 'deps/v8'], {
      ignoreFailure: false,
      spawnArgs: { cwd: ctx.nodeDir, stdio: 'ignore' }
    })
  };
}
