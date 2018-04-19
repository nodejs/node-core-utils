'use strict';

const execa = require('execa');
const Listr = require('listr');
const mkdirp = require('mkdirp');

const { v8Git } = require('./constants');

module.exports = function() {
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
        await execa('git', ['fetch', 'origin'], { cwd: ctx.v8CloneDir });
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
    task: (ctx) => {
      mkdirp.sync(ctx.baseDir);
      return execa('git', ['clone', v8Git], { cwd: ctx.baseDir });
    },
    enabled: (ctx) => ctx.shouldClone
  };
}
