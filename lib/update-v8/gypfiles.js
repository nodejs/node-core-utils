'use strict';

const path = require('path');

const fs = require('fs-extra');

function nodeOwnsGypfiles(ctx) {
  if (ctx.currentVersion[0] === 6 && ctx.currentVersion[1] < 6) {
    return false;
  }
  return true;
}

function v8HasGypfiles(ctx) {
  return ctx.newVersion[0] === 6 && ctx.newVersion[1] < 6;
}

function moveGypfilesOut() {
  return {
    title: 'Move gypfiles out',
    task: (ctx) => {
      return fs.move(
        path.join(ctx.nodeDir, 'deps/v8/gypfiles'),
        path.join(ctx.nodeDir, 'deps/v8-gypfiles')
      );
    },
    skip: (ctx) => v8HasGypfiles(ctx) || !nodeOwnsGypfiles(ctx)
  };
}

function moveGypfilesIn() {
  return {
    title: 'Move gypfiles in',
    task: (ctx) => {
      return fs.move(
        path.join(ctx.nodeDir, 'deps/v8-gypfiles'),
        path.join(ctx.nodeDir, 'deps/v8/gypfiles')
      );
    },
    skip: (ctx) => v8HasGypfiles(ctx) || !nodeOwnsGypfiles(ctx)
  };
}

function updateGypfiles() {
  return {
    title: 'Update gypfiles',
    task: async(ctx) => {
      // TODO(targos) Update v8.gyp based on BUILD.gn.
      // This is currently done manually.
      return null;
    },
    skip: (ctx) => v8HasGypfiles(ctx)
  };
}

module.exports = {
  moveGypfilesOut,
  moveGypfilesIn,
  updateGypfiles
};
