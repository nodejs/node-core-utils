'use strict';

const path = require('path');

const execa = require('execa');
const fs = require('fs-extra');
const Listr = require('listr');

const common = require('./common');

module.exports = function() {
  return {
    title: 'Minor V8 update',
    task: () => {
      return new Listr([
        common.getCurrentV8Version(),
        getLatestV8Version(),
        minorUpdate()
      ]);
    }
  };
};

function getLatestV8Version() {
  return {
    title: 'Get latest V8 version',
    task: async(ctx) => {
      const currentV8Tag = ctx.currentVersion.slice(0, 3).join('.');
      let tags = await execa.stdout('git', ['tag', '-l', `${currentV8Tag}.*`], {
        cwd: ctx.v8Dir
      });
      tags = toSortedArray(tags);
      ctx.latestVersion = tags[0];
    }
  };
}

function minorUpdate() {
  return {
    title: 'Do minor update',
    task: (ctx, task) => {
      if (ctx.latestVersion.length === 3) {
        throw new Error('minor update can only be done on release branches');
      }
      const latestStr = ctx.latestVersion.join('.');
      task.title = `Do minor update to ${latestStr}`;
      return doMinorUpdate(ctx, latestStr);
    },
    skip: (ctx) => {
      if (ctx.currentVersion[3] >= ctx.latestVersion[3]) {
        ctx.skipped = 'V8 is up-to-date';
        return ctx.skipped;
      }
      return false;
    }
  };
}

async function doMinorUpdate(ctx, latestStr) {
  const currentStr = ctx.currentVersion.join('.');
  const diff = await execa.stdout(
    'git',
    ['format-patch', '--stdout', `${currentStr}...${latestStr}`],
    { cwd: ctx.v8Dir }
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
