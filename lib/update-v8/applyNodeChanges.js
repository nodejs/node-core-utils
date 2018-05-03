'use strict';

const path = require('path');

const fs = require('fs-extra');
const Listr = require('listr');

const {
  getNodeV8Version,
  filterForVersion,
  replaceGitignore
} = require('./util');

const nodeChanges = [
  {
    since: 66,
    task: removeEuStrip
  }
];

function applyNodeChanges() {
  return {
    title: 'Apply Node-specific changes',
    task: (ctx) => {
      const v8Version = getNodeV8Version(ctx.nodeDir);
      const list = filterForVersion(nodeChanges, v8Version);
      return new Listr(list.map((change) => change.task()));
    }
  };
}

// Ref: https://github.com/nodejs/node/pull/20304
function removeEuStrip() {
  return {
    title: 'Remove eu-strip binary',
    task: async(ctx) => {
      await replaceGitignore(ctx.nodeDir, {
        match: '!/third_party/eu-strip\n',
        replace: ''
      });
      await fs.remove(path.join(ctx.nodeDir, 'deps/v8/third_party/eu-strip'));
    }
  };
}

module.exports = applyNodeChanges;
