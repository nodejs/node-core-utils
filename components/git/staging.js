import CLI from '../../lib/cli.js';
import { runPromise } from '../../lib/run.js';
import { Staging } from '../../lib/staging.js';

export const command = 'staging';
export const describe = 'Automatic port commits to a release line branch';

const stagingOptions = {
  backport: {
    describe: 'The PR ID / number to backport, skip staging commits',
    type: 'number'
  },
  paginate: {
    describe: 'Sets a maximum number of commits to port',
    type: 'number'
  },
  skipGH: {
    describe: 'Skip `gh` cli actions. Will not comment / label GitHub PRs',
    type: 'boolean'
  },
  releaseLine: {
    describe: 'The major version of the target release',
    type: 'number'
  },
  reporter: {
    describe: 'The reporter to use for the output',
    type: 'string',
    default: 'json'
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
  const { backport, paginate, releaseLine, reporter, skipGH } = argv;
  const staging = new Staging({
    cli,
    dir,
    paginate,
    skipGH,
    releaseLine,
    reporter
  });
  if (backport) {
    await staging.requestBackport(backport);
  } else {
    await staging.run();
  }
}
