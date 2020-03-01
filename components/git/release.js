'use strict';

const semver = require('semver');
const yargs = require('yargs');

const auth = require('../../lib/auth');
const CLI = require('../../lib/cli');
const Release = require('../../lib/release');
const Request = require('../../lib/request');
const TeamInfo = require('../../lib/team_info');
const { runPromise } = require('../../lib/run');

const PREPARE = 'prepare';
const PROMOTE = 'promote';

const RELEASERS = 'releasers';

const releaseOptions = {
  prepare: {
    describe: 'Prepare a new release with the given version number',
    type: 'boolean'
  },
  security: {
    describe: 'Prepare a new security release',
    type: 'boolean'
  }
};

function builder(yargs) {
  return yargs
    .options(releaseOptions).positional('newVersion', {
      describe: 'Version number of the release to be created'
    })
    .example('git node release 1.2.3',
      'Prepare a new release of Node.js tagged v1.2.3');
}

function handler(argv) {
  if (argv.newVersion) {
    const newVersion = semver.coerce(argv.newVersion);
    if (semver.valid(newVersion)) {
      return release(PREPARE, argv);
    }
  }

  // If more than one action is provided or no valid action
  // is provided, show help.
  yargs.showHelp();
}

function release(state, argv) {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);

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
  command: 'release [newVersion|options]',
  describe:
    'Manage an in-progress release or start a new one.',
  builder,
  handler
};

async function main(state, argv, cli, req, dir) {
  const release = new Release(state, argv, cli, req, dir);

  cli.startSpinner('Verifying Releaser status');
  const credentials = await auth({ github: true });
  const request = new Request(credentials);
  const info = new TeamInfo(cli, request, 'nodejs', RELEASERS);
  const releasers = await info.getMembers();
  if (!releasers.some(r => r.login === release.username)) {
    cli.stopSpinner(`${release.username} is not a Releaser; aborting release`);
    return;
  }
  cli.stopSpinner('Verified Releaser status');

  if (state === PREPARE) {
    if (release.warnForWrongBranch()) return;

    // Check the branch diff to determine if the releaser
    // wants to backport any more commits before proceeding.
    cli.startSpinner('Fetching branch-diff');
    const raw = release.checkBranchDiff();
    const diff = raw.split('*');
    cli.stopSpinner('Got branch diff');

    const staging = `v${semver.major(argv.newVersion)}.x-staging`;
    const proceed = await cli.prompt(
      `There are ${diff.length} commits that may be backported ` +
      `to ${staging} - do you still want to proceed?`,
      false);

    if (!proceed) {
      const seeDiff = await cli.prompt(
        'Do you want to see the branch diff?', true);
      if (seeDiff) cli.log(raw);
      return;
    }

    return release.prepare();
  } else if (state === PROMOTE) {
    return release.promote();
  }
}
