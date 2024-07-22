import auth from '../../lib/auth.js';
import CLI from '../../lib/cli.js';
import ReleasePreparation from '../../lib/prepare_release.js';
import ReleasePromotion from '../../lib/promote_release.js';
import TeamInfo from '../../lib/team_info.js';
import Request from '../../lib/request.js';
import { runPromise } from '../../lib/run.js';

export const command = 'release [prid|options]';
export const describe = 'Manage an in-progress release or start a new one.';

const PREPARE = 'prepare';
const PROMOTE = 'promote';
const RELEASERS = 'releasers';

const releaseOptions = {
  prepare: {
    describe: 'Prepare a new release of Node.js',
    type: 'boolean'
  },
  promote: {
    describe: 'Promote new release of Node.js',
    type: 'boolean'
  },
  security: {
    describe: 'Demarcate the new security release as a security release',
    type: 'boolean'
  },
  newVersion: {
    describe: 'Version number of the release to be prepared',
    type: 'string'
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
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs
    .options(releaseOptions).positional('prid', {
      describe: 'PR number of the release to be promoted',
      type: 'number'
    })
    .example('git node release --prepare --security',
      'Prepare a new security release of Node.js with auto-determined version')
    .example('git node release --prepare --newVersion=1.2.3',
      'Prepare a new release of Node.js tagged v1.2.3')
    .example('git node release --promote 12345',
      'Promote a prepared release of Node.js with PR #12345')
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

  return runPromise(main(state, argv, cli, dir)).catch((err) => {
    if (cli.spinner.enabled) {
      cli.spinner.fail();
    }
    throw err;
  });
}

async function main(state, argv, cli, dir) {
  let release;

  if (state === PREPARE) {
    release = new ReleasePreparation(argv, cli, dir);

    if (release.warnForWrongBranch()) return;

    // If the new version was automatically calculated, confirm it.
    if (!argv.newVersion) {
      const create = await cli.prompt(
        `Create release with new version ${release.newVersion}?`,
        { defaultAnswer: true });

      if (!create) {
        cli.error('Aborting release preparation process');
        return;
      }
    }

    return release.prepare();
  } else if (state === PROMOTE) {
    release = new ReleasePromotion(argv, cli, dir);

    cli.startSpinner('Verifying Releaser status');
    const credentials = await auth({ github: true });
    const request = new Request(credentials);
    const info = new TeamInfo(cli, request, 'nodejs', RELEASERS);

    const releasers = await info.getMembers();
    if (release.username === undefined) {
      cli.stopSpinner('Failed to verify Releaser status');
      cli.info(
        'Username was undefined - do you have your .ncurc set up correctly?');
      return;
    } else {
      if (!releasers.some(r => r.login === release.username)) {
        cli.stopSpinner(
          `${release.username} is not a Releaser; aborting release`);
        return;
      }
      cli.stopSpinner('Verified Releaser status');
    }

    return release.promote();
  }
}
