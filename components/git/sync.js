'use strict';

const CLI = require('../../lib/cli');
const { runPromise } = require('../../lib/run');
const SyncSession = require('../../lib/sync_session');

function builder(yargs) {
  return yargs
    .epilogue('Demo: https://asciinema.org/a/221230')
    .wrap(90);
}

async function main() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const dir = process.cwd();
  const session = new SyncSession(cli, dir);
  await session.sync();
}

function handler(argv) {
  return runPromise(main());
}

module.exports = {
  command: 'sync',
  describe: 'Sync the branch specified by ncu-config.',
  builder,
  handler
};
