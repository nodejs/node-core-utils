'use strict';

const yargs = require('yargs');

const getMetadata = require('../metadata');
const CLI = require('../../lib/cli');
const config = require('../../lib/config').getMergedConfig();

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

function builder(yargs) {
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

const PR_RE = new RegExp(
  '^https://github.com/(\\w+)/([a-zA-Z.-]+)/pull/' +
  '([0-9]+)(?:/(?:files)?)?$');

function handler(argv) {
  const parsed = {};
  const prid = Number.parseInt(argv.identifier);
  if (!Number.isNaN(prid)) {
    parsed.prid = prid;
  } else if (PR_RE.test(argv.identifier)) {
    const match = argv.identifier.match(PR_RE);
    parsed.owner = match[1];
    parsed.repo = match[2];
    parsed.prid = Number.parseInt(match[3]);
  } else {
    return yargs.showHelp();
  }

  if (!Number.isInteger(argv.maxCommits) || argv.maxCommits < 0) {
    return yargs.showHelp();
  }

  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);

  return getMetadata(Object.assign({}, config, argv, parsed), cli)
    .then(({status}) => {
      if (status === false) {
        throw new Error('PR checks failed');
      }
    })
    .catch((err) => {
      if (cli.spinner.enabled) {
        cli.spinner.fail();
      }
      cli.error(err);
      process.exit(1);
    });
}

module.exports = {
  command: 'metadata <identifier>',
  describe: 'Retrieves metadata for a PR and validates them against ' +
            'nodejs/node PR rules',
  builder,
  handler
};
