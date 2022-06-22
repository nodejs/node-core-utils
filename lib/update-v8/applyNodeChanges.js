import path from 'node:path';

import Enquirer from 'enquirer';
import { Listr } from 'listr2';

import {
  getNodeV8Version,
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
    task: async(ctx) => {
      const v8Version = await getNodeV8Version(ctx.nodeDir);
      const list = filterForVersion(nodeChanges, v8Version);
      return new Listr(list.map((change) => change.task()), {
        injectWrapper: {
          enquirer: new Enquirer()
        }
      });
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
