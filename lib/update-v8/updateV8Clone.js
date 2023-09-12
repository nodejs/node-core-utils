import { promises as fs } from 'node:fs';

import Enquirer from 'enquirer';
import { Listr } from 'listr2';

import { v8Git } from './constants.js';
import { runAsync } from '../run.js';

export default function updateV8Clone() {
  return {
    title: 'Update local V8 clone',
    task: () => {
      return new Listr([fetchOrigin(), createClone()], {
        injectWrapper: {
          enquirer: new Enquirer()
        }
      });
    }
  };
};

function fetchOrigin() {
  return {
    title: 'Fetch V8',
    task: async(ctx, task) => {
      try {
        await runAsync('git', ['fetch', 'origin'], {
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
      await runAsync('git', ['clone', v8Git], {
        spawnArgs: { cwd: ctx.baseDir, stdio: 'ignore' }
      });
    },
    enabled: (ctx) => ctx.shouldClone
  };
}
