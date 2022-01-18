import path from 'node:path';
import { promises as fs } from 'node:fs';

import { Listr } from 'listr2';

import { getNodeV8Version } from './util.js';

export default function updateVersionNumbers() {
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
      const v8Version = await getNodeV8Version(ctx.nodeDir);
      const newModuleVersion = await updateModuleVersionRegistry(
        ctx.nodeDir,
        v8Version,
        ctx.nodeMajorVersion
      );
      await updateModuleVersion(ctx.nodeDir, newModuleVersion);
      await ctx.execGitNode(
        'add',
        ['doc/abi_version_registry.json', 'src/node_version.h']
      );
      await ctx.execGitNode(
        'commit',
        [
          '-m',
          getCommitTitle(newModuleVersion),
          '-m',
          getCommitBody(v8Version)
        ]
      );
    },
    skip: (ctx) => !ctx.versionBump
  };
}

async function updateModuleVersionRegistry(
  nodeDir,
  v8Version,
  nodeMajorVersion
) {
  const registryFile = `${nodeDir}/doc/abi_version_registry.json`;
  const registryStr = await fs.readFile(registryFile, 'utf8');
  const registry = JSON.parse(registryStr);
  const newVersion = registry.NODE_MODULE_VERSION[0].modules + 1;
  const newLine =
    `{ "modules": ${newVersion}, "runtime": "node", ` +
    `"variant": "v8_${v8Version.major}.${v8Version.minor}", ` +
    `"versions": "${nodeMajorVersion}.0.0-pre" },\n    `;
  const firstLineIndex = registryStr.indexOf('{ "modules"');
  const newRegistry =
    registryStr.substring(0, firstLineIndex) +
    newLine +
    registryStr.substring(firstLineIndex);
  await fs.writeFile(registryFile, newRegistry);
  return newVersion;
}

async function updateModuleVersion(nodeDir, newVersion) {
  const path = `${nodeDir}/src/node_version.h`;
  let nodeVersionH = await fs.readFile(path, 'utf8');
  nodeVersionH = nodeVersionH.replace(
    /NODE_MODULE_VERSION \d+/,
    `NODE_MODULE_VERSION ${newVersion}`
  );
  await fs.writeFile(path, nodeVersionH);
}

function getCommitTitle(moduleVersion) {
  return `src: update NODE_MODULE_VERSION to ${moduleVersion}`;
}

function getCommitBody(v8Version) {
  return `Major V8 updates are usually API/ABI incompatible with previous
versions. This commit adapts NODE_MODULE_VERSION for V8 ${v8Version.major}.${
  v8Version.minor
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
        await ctx.execGitNode('add', ['common.gypi']);
        await ctx.execGitNode(
          'commit',
          ['-m', 'build: reset embedder string to "-node.0"']
        );
      } else {
        return task.skip('Embedder version is already 0');
      }
      return null;
    },
    skip: (ctx) => ctx.nodeMajorVersion < 9
  };
}
