import CLI from '../../lib/cli.js';
import ReleasePreparation from '../../lib/prepare_release.js';
import { runPromise } from '../../lib/run.js';

export const command = 'release [newVersion|options]';
export const describe = 'Manage an in-progress release or start a new one.';

const PREPARE = 'prepare';
const PROMOTE = 'promote';

const releaseOptions = {
  prepare: {
    describe: 'Prepare a new release of Node.js',
    type: 'boolean'
  },
  promote: {
    describe: 'Promote new release of Node.js',
    type: 'boolean'
  },
  releaseDate: {
    describe: 'Default relase date when --prepare is used. It must be YYYY-MM-DD',
    type: 'string'
  },
  security: {
    describe: 'Demarcate the new security release as a security release',
    type: 'boolean'
  },
  filterLabel: {
    describe: 'Labels separated by "," to filter security PRs',
    type: 'string'
  },
  skipBranchDiff: {
    describe: 'Skips the initial branch-diff check when preparing releases',
    type: 'boolean'
  },
  startLTS: {
    describe: 'Mark the release as the transition from Current to LTS',
    type: 'boolean'
  },
  yes: {
    type: 'boolean',
    default: false,
    describe: 'Skip all prompts and run non-interactively'
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs
    .options(releaseOptions).positional('newVersion', {
      describe: 'Version number of the release to be prepared or promoted'
    })
    .example('git node release --prepare 1.2.3',
      'Prepare a release of Node.js tagged v1.2.3')
    .example('git node --prepare --startLTS',
      'Prepare the first LTS release');
}

export function handler(argv) {
  if (argv.prepare) {
    return release(PREPARE, argv);
  } else if (argv.promote) {
    return release(PROMOTE, argv);
  }

  // If more than one action is provided or no valid action
  // is provided, show help.
  yargsInstance.showHelp();
}

function release(state, argv) {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const dir = process.cwd();

  if (argv.yes) {
    cli.setAssumeYes();
  }

  return runPromise(main(state, argv, cli, dir)).catch((err) => {
    if (cli.spinner.enabled) {
      cli.spinner.fail();
    }
    throw err;
  });
}

async function main(state, argv, cli, dir) {
  if (state === PREPARE) {
    const prep = new ReleasePreparation(argv, cli, dir);

    await prep.prepareLocalBranch();

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

    return prep.prepare();
  } else if (state === PROMOTE) {
    // TODO(codebytere): implement release promotion.
  }
}
