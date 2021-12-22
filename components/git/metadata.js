import { parsePRFromURL } from '../../lib/links.js';
import { getMetadata } from '../metadata.js';
import CLI from '../../lib/cli.js';
import { getMergedConfig } from '../../lib/config.js';
import { runPromise, IGNORE } from '../../lib/run.js';

export const command = 'metadata <identifier>';
export const describe =
  'Retrieves metadata for a PR and validates them against nodejs/node PR rules';

const config = getMergedConfig();

const options = {
  owner: {
    alias: 'o',
    describe: 'GitHub owner of the PR repository',
    default: 'nodejs',
    type: 'string'
  },
  repo: {
    default: 'node',
    alias: 'r',
    describe: 'GitHub repository of the PR',
    type: 'string'
  },
  file: {
    alias: 'f',
    describe: 'File to write the metadata in',
    type: 'string'
  },
  readme: {
    describe: 'Path to file that contains collaborator contacts',
    type: 'string'
  },
  'check-comments': {
    describe: 'Check for \'LGTM\' in comments',
    type: 'boolean'
  },
  'max-commits': {
    describe: 'Number of commits to warn',
    type: 'number',
    default: 3
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs
    .options(options)
    .positional('identifier', {
      type: 'string',
      describe: 'ID or URL of the pull request'
    })
    .example('git node metadata 12344',
      'Retrieve the metadata of https://github.com/nodejs/node/pull/12344 ' +
      'and validate the PR')
    .example('git node metadata https://github.com/nodejs/node/pull/12344',
      'Retrieve the metadata of https://github.com/nodejs/node/pull/12344 ' +
      'and validate it')
    .example('git node metadata 167 --repo llnode --readme ../node/README.md',
      'Retrieve the metadata of https://github.com/nodejs/llnode/pull/167 ' +
      'and validate it using the README in ../node/README.md')
    .wrap(90);
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

  if (!Number.isInteger(argv.maxCommits) || argv.maxCommits < 0) {
    return yargsInstance.showHelp();
  }

  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);

  const merged = Object.assign({}, argv, parsed, config);
  return runPromise(getMetadata(merged, false, cli)
    .then(({ status }) => {
      if (status === false) {
        throw new Error(IGNORE);
      }
    }));
}
