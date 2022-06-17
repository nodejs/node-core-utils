import { parsePRFromURL } from '../../lib/links.js';
import CLI from '../../lib/cli.js';
import { runPromise } from '../../lib/run.js';
import BackportSession from '../../lib/backport_session.js';

export const command = 'backport <identifier>';
export const describe = 'Backport a PR to a release staging branch.';

const epilogue = `====================== Example =======================
Demo: https://asciinema.org/a/221244
Backporting https://github.com/nodejs/node/pull/24816 to v11.x

# Sync main with upstream for the commits, if they are not yet there
$ git checkout main
$ ncu-config set branch main
$ git node sync

# Backport existing commits from main to v11.x-staging
$ git checkout v11.x-staging
$ ncu-config set branch v11.x-staging
$ git node sync
$ git node backport 24816 --to 11
=====================================================
`;

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs
    .options({
      to: {
        describe: 'release to backport the commits to',
        type: 'number',
        required: true
      }
    })
    .positional('identifier', {
      type: 'string',
      describe: 'ID or URL of the pull request'
    })
    .epilogue(epilogue)
    .wrap(90);
}

async function main(argv, parsed) {
  const merged = (await import('../../lib/config.js')).getMergedConfig();
  const config = Object.assign({}, argv, parsed, merged);
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  cli.setFigureIndent(0);
  const dir = process.cwd();
  const session = new BackportSession(cli, dir, config.prid, config.to);
  return session.backport();
}

export function handler(argv) {
  let parsed = {};
  const prid = Number.parseInt(argv.identifier);
  if (!Number.isNaN(prid)) {
    parsed.prid = prid;
  } else {
    parsed = parsePRFromURL(argv.identifier);
    if (!parsed) {
      return yargsInstance.showHelp();
    }
  }

  return runPromise(main(argv, parsed));
}
