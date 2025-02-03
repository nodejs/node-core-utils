import CLI from '../../lib/cli.js';
import { runPromise } from '../../lib/run.js';
import { Staging } from '../../lib/staging.js';

export const command = 'staging';
export const describe = 'Automatic port commits to a release line branch';

const stagingOptions = {
  autoSkip: {
    describe: 'Automatically skip commits with conflicts that have to be manually resolved',
    type: 'boolean'
  },
  backport: {
    describe: 'The PR ID / number to backport, skip staging commits',
    type: 'number'
  },
  continue: {
    describe: 'Continue the staging process after a conflict',
    type: 'boolean'
  },
  paginate: {
    describe: 'Sets a maximum number of commits to port',
    type: 'number'
  },
  releaseLine: {
    describe: 'The major version of the target release',
    type: 'number'
  },
  reportDestination: {
    describe: 'The destination to write the report to. Possible values are: ' +
      'stdout, github, or a file path, defaults to an interactive prompt.',
    type: 'string',
    default: undefined
  },
  reporter: {
    describe: 'The reporter to use for the output',
    type: 'string',
    default: 'markdown'
  },
  reset: {
    describe: 'Reset the staging process',
    type: 'boolean'
  },
  skip: {
    describe: 'Continue the staging process marking the current commit as skipped',
    type: 'boolean'
  },
  skipGH: {
    describe: 'Skip all `gh` cli actions. Will not read / add label to GitHub PRs',
    type: 'boolean'
  }
};

export function builder(yargs) {
  return yargs
    .options(stagingOptions)
    .example('git node staging --releaseLine=23',
      'Port commits to the v1.x-staging branch');
}

export function handler(argv) {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const dir = process.cwd();

  return runPromise(main(argv, cli, dir)).catch((err) => {
    if (cli.spinner.enabled) {
      cli.spinner.fail();
    }
    throw err;
  });
}

async function main(argv, cli, dir) {
  const {
    autoSkip,
    backport,
    paginate,
    releaseLine,
    reportDestination,
    reporter,
    reset,
    skip,
    skipGH
  } = argv;
  const staging = new Staging({
    cli,
    dir,
    cont: argv.continue,
    autoSkip,
    paginate,
    releaseLine,
    reportDestination,
    reporter,
    skip,
    skipGH
  });
  if (backport) {
    await staging.requestBackport(backport);
  } else if (reset) {
    await staging.reset();
  } else {
    await staging.run();
  }
}
