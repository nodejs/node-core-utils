import path from 'node:path';
import { promises as fs } from 'node:fs';

import Enquirer from 'enquirer';
import { execa } from 'execa';
import { Listr } from 'listr2';

import { getCurrentV8Version } from './common.js';

export default function minorUpdate() {
  return {
    title: 'Minor V8 update',
    task: () => {
      return new Listr([
        getCurrentV8Version(),
        getLatestV8Version(),
        doMinorUpdate()
      ], {
        injectWrapper: {
          enquirer: new Enquirer()
        }
      });
    }
  };
};

function getLatestV8Version() {
  return {
    title: 'Get latest V8 version',
    task: async(ctx) => {
      const version = ctx.currentVersion;
      const currentV8Tag = `${version.major}.${version.minor}.${version.build}`;
      const result = await execa('git', ['tag', '-l', `${currentV8Tag}.*`], {
        cwd: ctx.v8Dir,
        encoding: 'utf8'
      });
      const tags = toSortedArray(result.stdout);
      ctx.latestVersion = tags[0];
    }
  };
}

function doMinorUpdate() {
  return {
    title: 'Do minor update',
    task: (ctx, task) => {
      if (ctx.latestVersion.length === 3) {
        throw new Error('minor update can only be done on release branches');
      }
      const latestStr = ctx.latestVersion.join('.');
      task.title = `Do minor update to ${latestStr}`;
      return applyPatch(ctx, latestStr);
    },
    skip: (ctx) => {
      if (ctx.currentVersion.patch >= ctx.latestVersion[3]) {
        ctx.skipped = 'V8 is up-to-date';
        return ctx.skipped;
      }
      return false;
    }
  };
}

async function applyPatch(ctx, latestStr) {
  const { stdout: diff } = await execa(
    'git',
    ['format-patch', '--stdout', `${ctx.currentVersion}...${latestStr}`],
    { cwd: ctx.v8Dir, encoding: 'utf8' }
  );
  try {
    await execa('git', ['apply', '--directory', 'deps/v8'], {
      cwd: ctx.nodeDir,
      input: diff
    });
  } catch (e) {
    const file = path.join(ctx.nodeDir, `${latestStr}.diff`);
    await fs.writeFile(file, diff);
    throw new Error(`Could not apply patch.\n${e}\nDiff was stored in ${file}`);
  }
}

function toSortedArray(tags) {
  return tags
    .split(/[\r\n]+/)
    .filter((tag) => tag !== '')
    .map((tag) => tag.split('.'))
    .sort(sortVersions);
}

function sortVersions(v1, v2) {
  return v2[3] - v1[3];
}
