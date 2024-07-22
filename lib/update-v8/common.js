import path from 'node:path';
import { promises as fs } from 'node:fs';

import { getNodeV8Version } from './util.js';

export function getCurrentV8Version() {
  return {
    title: 'Get current V8 version',
    task: async(ctx) => {
      ctx.currentVersion = await getNodeV8Version(ctx.nodeDir);
    }
  };
};

export async function checkCwd(ctx) {
  let isNode = false;
  try {
    const nodeVersion = await fs.readFile(
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
