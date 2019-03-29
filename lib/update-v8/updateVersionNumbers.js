'use strict';

const path = require('path');

const fs = require('fs-extra');
const Listr = require('listr');

const util = require('./util');

module.exports = function() {
  return {
    title: 'Update version numbers',
    task: () => {
      return new Listr([resetEmbedderString(), bumpNodeModule()]);
    }
  };
};

function bumpNodeModule() {
  return {
    title: 'Bump NODE_MODULE_VERSION',
    task: async(ctx) => {
      const v8Version = util.getNodeV8Version(ctx.nodeDir);
      const currentModuleVersion = getModuleVersion(ctx.nodeDir);
      const newModuleVersion = currentModuleVersion + 1;
      updateModuleVersion(ctx.nodeDir, newModuleVersion, v8Version);
      await ctx.execGitNode('add', 'src/node_version.h');
      await ctx.execGitNode(
        'commit',
        '-m',
        getCommitTitle(newModuleVersion),
        '-m',
        getCommitBody(v8Version)
      );
    },
    skip: (ctx) => ctx.noVersionBump
  };
}

function getModuleVersion(nodeDir) {
  const nodeVersionH = fs.readFileSync(`${nodeDir}/src/node_version.h`, 'utf8');
  const version = /NODE_MODULE_VERSION (\d+)/.exec(nodeVersionH)[1];
  return parseInt(version, 10);
}

const v8VerReg = / * V8 \d+\.\d+: \d+/g;
function updateModuleVersion(nodeDir, newVersion, v8Version) {
  const path = `${nodeDir}/src/node_version.h`;
  let nodeVersionH = fs.readFileSync(path, 'utf8');
  nodeVersionH = nodeVersionH.replace(
    /NODE_MODULE_VERSION \d+/,
    `NODE_MODULE_VERSION ${newVersion}`
  );
  let index = -1;
  while (v8VerReg.exec(nodeVersionH)) index = v8VerReg.lastIndex;
  nodeVersionH = `${nodeVersionH.substring(0, index)}\n * V8 ${v8Version[0]}.${
    v8Version[1]
  }: ${newVersion}${nodeVersionH.substring(index)}`;
  fs.writeFileSync(path, nodeVersionH);
}

function getCommitTitle(moduleVersion) {
  return `src: update NODE_MODULE_VERSION to ${moduleVersion}`;
}

function getCommitBody(v8Version) {
  return `Major V8 updates are usually API/ABI incompatible with previous
versions. This commit adapts NODE_MODULE_VERSION for V8 ${v8Version[0]}.${
  v8Version[1]
}.

Refs: https://github.com/nodejs/CTC/blob/master/meetings/2016-09-28.md`;
}

const embedderRegex = /'v8_embedder_string': '-node\.(\d+)'/;
const embedderString = "'v8_embedder_string': '-node.0'";
function resetEmbedderString() {
  return {
    title: 'Reset V8 embedder version string',
    task: async(ctx, task) => {
      const commonGypiPath = path.join(ctx.nodeDir, 'common.gypi');
      const commonGypi = await fs.readFile(commonGypiPath, 'utf8');
      const embedderValue = embedderRegex.exec(commonGypi)[1];
      if (embedderValue !== '0') {
        await fs.writeFile(
          commonGypiPath,
          commonGypi.replace(embedderRegex, embedderString)
        );
        await ctx.execGitNode('add', 'common.gypi');
        await ctx.execGitNode(
          'commit',
          '-m',
          'build: reset embedder string to "-node.0"'
        );
      } else {
        return task.skip('Embedder version is already 0');
      }
      return null;
    },
    skip: (ctx) => ctx.nodeMajorVersion < 9
  };
}
