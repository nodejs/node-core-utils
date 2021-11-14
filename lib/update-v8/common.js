'use strict';

const path = require('path');

const {
  promises: {
    readFile
  }
} = require('fs');

const util = require('./util');

exports.getCurrentV8Version = function getCurrentV8Version() {
  return {
    title: 'Get current V8 version',
    task: async(ctx) => {
      ctx.currentVersion = await util.getNodeV8Version(ctx.nodeDir);
    }
  };
};

exports.checkCwd = async function checkCwd(ctx) {
  let isNode = false;
  try {
    const nodeVersion = await readFile(
      path.join(ctx.nodeDir, 'src/node_version.h')
    );
    const match = /#define NODE_MAJOR_VERSION (\d+)/.exec(nodeVersion);
    if (match) {
      isNode = true;
      ctx.nodeMajorVersion = parseInt(match[1], 10);
    }
  } catch (e) {
    // ignore
  }
  if (!isNode) {
    throw new Error(
      'This does not seem to be the Node.js repository.\n' +
      `node-dir: ${ctx.nodeDir}`
    );
  }
};
