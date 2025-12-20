import path from 'node:path';
import { promises as fs } from 'node:fs';

import { chromiumGit, v8Deps } from './constants.js';
import { forceRunAsync } from '../run.js';
import {
  addToGitignore,
  filterForVersion,
  getNodeV8Version,
  removeDirectory,
  replaceGitignore,
} from './util.js';

async function fetchFromGit(cwd, repo, commit) {
  await removeDirectory(cwd);
  await fs.mkdir(cwd, { recursive: true });
  await exec('init');
  await exec('remote', 'add', 'origin', repo);
  await exec('fetch', 'origin', commit);
  await exec('reset', '--hard', 'FETCH_HEAD');
  await removeDirectory(path.join(cwd, '.git'));

  function exec(...options) {
    return forceRunAsync('git', options, {
      ignoreFailure: false,
      spawnArgs: { cwd, stdio: 'ignore' }
    });
  }
}

async function readDeps(nodeDir) {
  const depsStr = await fs.readFile(path.join(nodeDir, 'deps/v8/DEPS'), 'utf8');
  const start = depsStr.indexOf('deps = {');
  const end = depsStr.indexOf('\n}', start) + 2;
  const depsDeclaration = depsStr.substring(start, end).replace(/^ *#.*/gm, '');
  const Var = () => chromiumGit; // eslint-disable-line no-unused-vars
  let deps;
  eval(depsDeclaration); // eslint-disable-line no-eval
  return deps;
}

async function lookupDep(depsTable, depName) {
  const dep = depsTable[depName];
  if (!dep) {
    throw new Error(`V8 dep "${depName}" not found in DEPS file`);
  }
  if (typeof dep === 'object') {
    return dep.url.split('@');
  }
  return dep.split('@');
}

export default function updateV8Deps() {
  return {
    title: 'Update V8 DEPS',
    task: async(ctx, task) => {
      const newV8Version = await getNodeV8Version(ctx.nodeDir);
      const repoPrefix = newV8Version.majorMinor >= 86 ? '' : 'v8/';
      const deps = filterForVersion(v8Deps.map((v8Dep) => ({
        ...v8Dep,
        repo: `${repoPrefix}${v8Dep.repo}`,
        path: v8Dep.repo
      })), newV8Version);
      if (deps.length === 0) return;
      const depsTable = await readDeps(ctx.nodeDir);
      const subtasks = [];
      for (const dep of deps) {
        // Update .gitignore sequentially to avoid races
        if (dep.gitignore) {
          if (typeof dep.gitignore === 'string') {
            await addToGitignore(ctx.nodeDir, dep.gitignore);
          } else {
            await replaceGitignore(ctx.nodeDir, dep.gitignore);
          }
        }
        subtasks.push({
          title: `Update ${dep.path}`,
          task: async(ctx) => {
            const [repo, commit] = await lookupDep(depsTable, dep.repo);
            const thePath = path.join(ctx.nodeDir, 'deps/v8', dep.path);
            await fetchFromGit(thePath, repo, commit);
          }
        });
      }
      return task.newListr(subtasks, { concurrent: ctx.concurrent });
    }
  };
};
