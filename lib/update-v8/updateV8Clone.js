import { promises as fs } from 'node:fs';

import { execa } from 'execa';
import { Listr } from 'listr2';

import { v8Git } from './constants.js';

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
        await execa('git', ['fetch', 'origin'], { cwd: ctx.v8Dir });
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
      await execa('git', ['clone', v8Git], { cwd: ctx.baseDir });
    },
    enabled: (ctx) => ctx.shouldClone
  };
}
