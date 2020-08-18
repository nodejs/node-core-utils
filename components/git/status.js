'use strict';

const path = require('path');
const fs = require('fs');

const { readJson } = require('./../../lib/file');
const { getNcuDir } = require('./../../lib/config');

const CLI = require('../../lib/cli');

const cli = new CLI();

function handler() {
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

module.exports = {
  command: 'status',
  describe: 'Return status and information about' +
    'the current git-node land session.',
  handler: handler
};
