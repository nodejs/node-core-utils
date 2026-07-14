import path from 'node:path';

import {
  filterForVersion,
  replaceGitignore,
  removeDirectory
} from './util.js';

const nodeChanges = [
  {
    since: 66,
    task: removeEuStrip
  }
];

export default function applyNodeChanges() {
  return {
    title: 'Apply Node-specific changes',
    task: async(ctx, task) => {
      const list = filterForVersion(nodeChanges, ctx.newVersion);
      return task.newListr(list.map((change) => change.task()));
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
      await removeDirectory(
        path.join(ctx.nodeDir, 'deps/v8/third_party/eu-strip')
      );
    }
  };
}
