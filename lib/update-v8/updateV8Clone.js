import { promises as fs } from 'node:fs';

import { Listr } from 'listr2';

import { v8Git } from './constants.js';
import { forceRunAsync } from '../run.js';

export default function updateV8Clone() {
  return {
    title: 'Update local V8 clone',
    task: () => {
      return new Listr([fetchOrigin(), createClone()]);
    }
  };
};

function fetchOrigin() {
  return {
    title: 'Fetch V8',
    task: async(ctx, task) => {
      try {
        await forceRunAsync('git', ['fetch', 'origin'], {
          ignoreFailure: false,
          spawnArgs: { cwd: ctx.v8Dir, stdio: 'ignore' }
        });
      } catch (e) {
        if (e.code === 'ENOENT') {
          ctx.shouldClone = true;
          task.skip('V8 clone not present, create it.');
        } else {
          throw e;
        }
      }
    }
  };
}

function createClone() {
  return {
    title: 'Clone V8',
    task: async(ctx) => {
      await fs.mkdir(ctx.baseDir, { recursive: true });
      await forceRunAsync('git', ['clone', v8Git, ctx.v8Dir], {
        ignoreFailure: false,
        spawnArgs: { stdio: 'ignore' }
      });
    },
    enabled: (ctx) => ctx.shouldClone
  };
}
