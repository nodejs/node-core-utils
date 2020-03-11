'use strict';

const semver = require('semver');
const yargs = require('yargs');

const CLI = require('../../lib/cli');
const ReleasePreparation = require('../../lib/prepare_release');
const { runPromise } = require('../../lib/run');

const PREPARE = 'prepare';
const PROMOTE = 'promote';

const releaseOptions = {
  prepare: {
    describe: 'Prepare a new release with the given version number',
    type: 'boolean'
  },
  promote: {
    describe: 'Promote new release with the given version number',
    type: 'boolean'
  },
  security: {
    describe: 'Demarcate the new security release as a security release',
    type: 'boolean'
  }
};

function builder(yargs) {
  return yargs
    .options(releaseOptions).positional('newVersion', {
      describe: 'Version number of the release to be prepared or promoted'
    })
    .example('git node release --prepare 1.2.3',
      'Prepare a new release of Node.js tagged v1.2.3');
}

function handler(argv) {
  if (argv.prepare) {
    return release(PREPARE, argv);
  } else if (argv.promote) {
    return release(PROMOTE, argv);
  }

  // If more than one action is provided or no valid action
  // is provided, show help.
  yargs.showHelp();
}

function release(state, argv) {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const dir = process.cwd();

  return runPromise(main(state, argv, cli, dir)).catch((err) => {
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

async function main(state, argv, cli, dir) {
  if (state === PREPARE) {
    const prep = new ReleasePreparation(argv, cli, dir);

    if (prep.warnForWrongBranch()) return;

    // If the new version was automatically calculated, confirm it.
    if (!argv.newVersion) {
      const create = await cli.prompt(
        `Create release with new version ${prep.newVersion}?`,
        { defaultAnswer: true });

      if (!create) {
        cli.error('Aborting release preparation process');
        return;
      }
    }

    // Check the branch diff to determine if the releaser
    // wants to backport any more commits before proceeding.
    cli.startSpinner('Fetching branch-diff');
    const raw = prep.getBranchDiff({ onlyNotableChanges: false });
    const diff = raw.split('*');
    cli.stopSpinner('Got branch diff');

    const outstandingCommits = diff.length - 1;
    if (outstandingCommits !== 0) {
      const staging = `v${semver.major(prep.newVersion)}.x-staging`;
      const proceed = await cli.prompt(
        `There are ${outstandingCommits} commits that may be ` +
        `backported to ${staging} - do you still want to proceed?`,
        { defaultAnswer: false });

      if (!proceed) {
        const seeDiff = await cli.prompt(
          'Do you want to see the branch diff?');
        if (seeDiff) cli.log(raw);
        return;
      }
    }

    return prep.prepare();
  } else if (state === PROMOTE) {
    // TODO(codebytere): implement release promotion.
  }
}
