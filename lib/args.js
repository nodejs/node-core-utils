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
    .usage('$0 <identifier> [owner] [repo]', 'Retrieves metadata for a PR and validates them against nodejs/node PR rules')
    .detectLocale(false)
    .demandCommand(1, 'Pull request identifier (id or URL) is required as first argument.')
    .option('o', {
      alias: 'owner',
      demandOption: false,
      describe: 'GitHub owner of the PR repository',
      type: 'string'
    })
    .option('r', {
      alias: 'repo',
      demandOption: false,
      describe: 'GitHub repository of the PR',
      type: 'string'
    })
    .help('h')
    .alias('h', 'help')
    .argv;
}

function checkAndParseArgs(args) {
  if (typeof args.r === 'undefined' && typeof args.o !== 'undefined') {
    args.r = args.o || args.owner;
    args.o = 'nodejs';
  }
  // Fast path: numeric string
  if (!isNaN(args.identifier)) {
    return {
      owner: args.o || args.owner || 'nodejs',
      repo: args.r || args.repo || 'node',
      id: +args.identifier
    };
  }
  const match = args.identifier.match(/^https:\/\/github.com\/(\w+)\/([a-zA-Z.-]+)\/pull\/([0-9]+)(?:\/(?:files)?)?$/);
  if (match !== null) {
    if (typeof args.r !== 'undefined' || typeof args.o !== 'undefined') {
      throw new Error(`Cannot pass second or third argument when url given as first argument.`);
    }
    return {
      owner: `${match[1]}`,
      repo: `${match[2]}`,
      id: +match[3]
    };
  }
  throw new Error(`Could not understand PR id format: ${args}`);
}

module.exports = parseArgs;
