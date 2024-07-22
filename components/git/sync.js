import CLI from '../../lib/cli.js';
import { runPromise } from '../../lib/run.js';
import SyncSession from '../../lib/sync_session.js';

export const command = 'sync';
export const describe = 'Sync the branch specified by ncu-config.';

export function builder(yargs) {
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

export function handler(argv) {
  return runPromise(main());
}
