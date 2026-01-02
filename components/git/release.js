import auth from '../../lib/auth.js';
import CLI from '../../lib/cli.js';
import ReleasePreparation from '../../lib/prepare_release.js';
import ReleasePromotion from '../../lib/promote_release.js';
import TeamInfo from '../../lib/team_info.js';
import Request from '../../lib/request.js';
import { runPromise } from '../../lib/run.js';

export const command = 'release [prid..]';
export const describe = 'Manage an in-progress release or start a new one.';

const PREPARE = 'prepare';
const PROMOTE = 'promote';
const RELEASERS = 'releasers';

const releaseOptions = {
  filterLabel: {
    describe: 'Labels separated by "," to filter security PRs',
    type: 'string'
  },
  'gpg-sign': {
    describe: 'GPG-sign commits, will be passed to the git process',
    alias: 'S'
  },
  newVersion: {
    describe: 'Version number of the release to be prepared',
    type: 'string'
  },
  prepare: {
    describe: 'Prepare a new release of Node.js',
    type: 'boolean'
  },
  promote: {
    describe: 'Promote new release of Node.js',
    type: 'boolean'
  },
  fetchFrom: {
    describe: 'Remote to fetch the release proposal(s) from, if different from the one where to' +
              'push the tags and commits.',
    type: 'string',
  },
  releaseDate: {
    describe: 'Default release date when --prepare is used. It must be YYYY-MM-DD',
    type: 'string'
  },
  run: {
    describe: 'Run steps that involve touching more than the local clone, ' +
           'including `git push` commands. Might not work if a passphrase ' +
           'required to push to the remote clone.',
    type: 'boolean'
  },
  security: {
    describe: 'Demarcate the new security release as a security release. ' +
              'Optionally provide path to security-release repository for CVE auto-population',
    type: 'string',
    coerce: (arg) => {
      // If --security=path is used, return the path
      if (arg === '' || arg === true) return true;
      return arg;
    }
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
    .options(releaseOptions).positional('prid', {
      describe: 'PR number or URL of the release proposal to be promoted',
      type: 'string'
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
    const release = new ReleasePreparation(argv, cli, dir);

    await release.prepareLocalBranch();

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
    const credentials = await auth({ github: true });
    const request = new Request(credentials);
    const release = new ReleasePromotion(argv, request, cli, dir);

    cli.startSpinner('Verifying Releaser status');
    const info = new TeamInfo(cli, request, 'nodejs', RELEASERS);

    const releasers = await info.getMembers();
    if (release.username === undefined) {
      cli.stopSpinner('Failed to verify Releaser status');
      cli.info(
        'Username was undefined - do you have your .ncurc set up correctly?');
      return;
    } else if (releasers.every(r => r.login !== release.username)) {
      cli.stopSpinner(`${release.username} is not a Releaser`, 'failed');
      if (!argv.dryRun) {
        throw new Error('aborted');
      }
    } else {
      cli.stopSpinner(`${release.username} is a Releaser`);
    }

    const releases = [];
    for (const pr of argv.prid) {
      const match = /^(?:https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/)?(\d+)(?:#.*)?$/.exec(pr);
      if (!match) throw new Error('Invalid PR ID or URL', { cause: pr });
      const [,owner, repo, prid] = match;

      if (
        owner &&
        (owner !== release.owner || repo !== release.repo) &&
        !argv.fetchFrom
      ) {
        console.warn('The configured owner/repo does not match the PR URL.');
        console.info('You should either pass `--fetch-from` flag or check your configuration');
        console.info(`E.g. --fetch-from=git@github.com:${owner}/${repo}.git`);
        throw new Error('You need to tell what remote use to fetch security release proposal.');
      }
      releases.push(await release.preparePromotion({ owner, repo, prid: Number(prid) }));
    }
    return release.promote(releases);
  }
}
