import path from 'node:path';
import fs from 'node:fs';

import { readJson } from './../../lib/file.js';
import { getNcuDir } from './../../lib/config.js';
import CLI from '../../lib/cli.js';

const cli = new CLI();

export const command = 'status';
export const describe =
  'Return status and information about the current git-node land session.';

export function handler() {
  const ncuDir = getNcuDir(process.cwd());
  const landPath = path.join(ncuDir, 'land');

  if (fs.existsSync(landPath)) {
    const { state, prid, config } = readJson(landPath);
    const { username, branch, upstream } = config;

    cli.ok('Landing session in progress');
    cli.separator();
    cli.table('PR:', `https:/github.com/nodejs/node/pull/${prid}`);
    cli.table('State:', state);
    cli.table('Username:', username);
    cli.table('Upstream:', upstream);
    cli.table('Branch:', branch);
  } else {
    cli.warn('No landing session in progress');
  }
}
