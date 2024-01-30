import CLI from '../../lib/cli.js';
import SecurityReleaseSteward from '../../lib/prepare_security.js';
import FinalizeSecurityRelease from '../../lib/finalize_security_release.js';

export const command = 'security [options]';
export const describe = 'Manage an in-progress security release or start a new one.';

const securityOptions = {
  start: {
    describe: 'Start security release process',
    type: 'boolean'
  },
  finalize: {
    describe: 'Finalize the security release of Node.js',
    type: 'boolean'
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs.options(securityOptions).example(
    'git node security --start',
    'Prepare a security release of Node.js')
    .example(
      'git node security --finalize',
      'Finalize the date of the security release of Node.js'
    );
}

export function handler(argv) {
  if (argv.start) {
    return startSecurityRelease(argv);
  }
  if (argv.finalize) {
    return finalizeSecurityRelease(argv);
  }
  yargsInstance.showHelp();
}

async function finalizeSecurityRelease() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const finalize = new FinalizeSecurityRelease(cli);
  return finalize.start();
}

async function startSecurityRelease() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const release = new SecurityReleaseSteward(cli);
  return release.start();
}
