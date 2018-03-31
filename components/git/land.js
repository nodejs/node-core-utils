'use strict';

const getMetadata = require('../metadata');
const CLI = require('../../lib/cli');
const Request = require('../../lib/request');
const { runPromise } = require('../../lib/run');
const LandingSession = require('../../lib/landing_session');
const epilogue = require('./epilogue');
const yargs = require('yargs');

const landOptions = {
  apply: {
    describe: 'Apply a patch with the given PR id',
    type: 'number'
  },
  amend: {
    describe: 'Amend the current commit',
    type: 'boolean'
  },
  continue: {
    alias: 'c',
    describe: 'Continue the landing session',
    type: 'boolean'
  },
  final: {
    describe: 'Verify the landed PR and clean up',
    type: 'boolean'
  },
  abort: {
    describe: 'Abort the current landing session',
    type: 'boolean'
  }
};

function builder(yargs) {
  return yargs
    .options(landOptions).positional('prid', {
      describe: 'ID or URL of the Pull Request'
    })
    .epilogue(epilogue)
    .example('git node land https://github.com/nodejs/node/pull/12344',
      'Land https://github.com/nodejs/node/pull/12344 in the current directory')
    .example('git node land 12344',
      'Land https://github.com/nodejs/node/pull/12344 in the current directory')
    .example('git node land --abort',
      'Abort the current session')
    .example('git node land --amend',
      'Append metadata to the current commit message')
    .example('git node land --final',
      'Verify the landed PR and clean up')
    .example('git node land --continue',
      'Continue the current landing session');
}

const START = 'start';
const APPLY = 'apply';
const AMEND = 'amend';
const FINAL = 'final';
const CONTINUE = 'continue';
const ABORT = 'abort';

const GITHUB_PULL_REQUEST_URL = /github.com\/[^/]+\/[^/]+\/pull\/(\d+)/;

function handler(argv) {
  if (argv.prid &&
    (Number.isInteger(argv.prid) || argv.prid.match(GITHUB_PULL_REQUEST_URL))
  ) {
    return land(START, argv);
  }
  const provided = [];
  for (const type of Object.keys(landOptions)) {
    if (argv[type]) {
      provided.push(type);
    }
  }
  if (provided.length === 0) {
    yargs.showHelp();
    return;
  }
  if (provided.length > 1) {
    yargs.showHelp();
    return;
  }

  return land(provided[0], argv);
}

function land(state, argv) {
  const cli = new CLI(process.stderr);
  const req = new Request();
  const dir = process.cwd();

  return runPromise(main(state, argv, cli, req, dir)).catch((err) => {
    if (cli.spinner.enabled) {
      cli.spinner.fail();
    }
    throw err;
  });
}

module.exports = {
  command: 'land [prid|options]',
  describe:
    'Manage the current landing session or start a new one for a pull request',
  builder,
  handler
};

async function main(state, argv, cli, req, dir) {
  let session = new LandingSession(cli, req, dir);
  if (session.warnForMissing()) {
    return;
  }
  if (state !== AMEND && state !== CONTINUE && session.warnForWrongBranch()) {
    return;
  }

  try {
    session.restore();
  } catch (err) { // JSON error?
    if (state === ABORT) {
      await session.abort();
      return;
    }
    cli.warn(
      'Failed to detect previous session. ' +
      'please run `git node land --abort`');
    return;
  }

  if (state === START) {
    if (argv.prid.match && argv.prid.match(GITHUB_PULL_REQUEST_URL)) {
      argv.prid = Number(argv.prid.split('/').pop());
    }

    if (session.hasStarted()) {
      cli.warn(
        'Previous `git node land` session for ' +
        `${session.pullName} in progress.`);
      cli.log('run `git node land --abort` before starting a new session');
      return;
    }
    session = new LandingSession(cli, req, dir, argv.prid);
    const metadata = await getMetadata(session.argv, cli);
    return session.start(metadata);
  } else if (state === APPLY) {
    return session.apply();
  } else if (state === AMEND) {
    return session.amend();
  } else if (state === FINAL) {
    return session.final();
  } else if (state === ABORT) {
    return session.abort();
  } else if (state === CONTINUE) {
    return session.continue();
  }
}
