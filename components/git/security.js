import CLI from '../../lib/cli.js';
import SecurityReleaseSteward from '../../lib/prepare_security.js';

export const command = 'security [options]';
export const describe = 'Manage an in-progress security release or start a new one.';

const securityOptions = {
  start: {
    describe: 'Start security release process',
    type: 'boolean'
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs.options(securityOptions).example(
    'git node security --start',
    'Prepare a security release of Node.js');
}

export function handler(argv) {
  if (argv.start) {
    return startSecurityRelease(argv);
  }
  yargsInstance.showHelp();
}

async function startSecurityRelease(argv) {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const release = new SecurityReleaseSteward(cli);
  return release.start();
}
