'use strict';

const yargs = require('yargs');

function parseArgs(args = null) {
  return checkAndParseArgs(
    buildYargs(args)
  );
}

function buildYargs(args = null) {
  if (args === null) { args = process.argv.slice(2); }
  return yargs(args)
    .usage(
      '$0 <identifier>',
      'Retrieves metadata for a PR and validates them against ' +
      'nodejs/node PR rules')
    .detectLocale(false)
    .demandCommand(
      1,
      'Pull request identifier (id or URL) is required as first argument.')
    .option('owner', {
      alias: 'o',
      demandOption: false,
      describe: 'GitHub owner of the PR repository',
      type: 'string'
    })
    .option('repo', {
      alias: 'r',
      demandOption: false,
      describe: 'GitHub repository of the PR',
      type: 'string'
    })
    .option('file', {
      alias: 'f',
      demandOption: false,
      describe: 'File to write the metadata in',
      type: 'string'
    })
    .option('check-comments', {
      demandOption: false,
      describe: 'Check for \'LGTM\' in comments',
      type: 'boolean'
    })
    .help()
    .alias('help', 'h')
    .argv;
}

const PR_RE = new RegExp(
  '^https://github.com/(\\w+)/([a-zA-Z.-]+)/pull/' +
  '([0-9]+)(?:/(?:files)?)?$');

function checkAndParseArgs(args) {
  const {
    owner = 'nodejs', repo = 'node', identifier, file, checkComments
  } = args;
  const result = { owner, repo, file, checkComments };
  if (!isNaN(identifier)) {
    result.prid = +identifier;
  } else {
    const match = identifier.match(PR_RE);
    if (match === null) {
      throw new Error(`Could not understand PR id format: ${args}`);
    }
    Object.assign(result, {
      owner: `${match[1]}`,
      repo: `${match[2]}`,
      prid: +match[3]
    });
  }

  return result;
}

module.exports = parseArgs;
