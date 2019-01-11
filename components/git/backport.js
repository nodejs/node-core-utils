'use strict';

const yargs = require('yargs');
const { parsePRFromURL } = require('../../lib/links');
const CLI = require('../../lib/cli');
const { runPromise } = require('../../lib/run');
const BackportSession = require('../../lib/backport_session');

const epilogue = `====================== Example =======================
Demo: https://asciinema.org/a/221244
Backporting https://github.com/nodejs/node/pull/24816 to v11.x

# Sync master with upstream for the commits, if they are not yet there
$ git checkout master
$ ncu-config set branch master
$ git node sync

# Backport existing commits from master to v11.x-staging
$ git checkout v11.x-staging
$ ncu-config set branch v11.x-staging
$ git node sync
$ git node backport 24816 --to 11
=====================================================
`;

function builder(yargs) {
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

async function main(config) {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  cli.setFigureIndent(0);
  const dir = process.cwd();
  const session = new BackportSession(cli, dir, config.prid, config.to);
  return session.backport();
}

function handler(argv) {
  let parsed = {};
  const prid = Number.parseInt(argv.identifier);
  if (!Number.isNaN(prid)) {
    parsed.prid = prid;
  } else {
    parsed = parsePRFromURL(argv.identifier);
    if (!parsed) {
      return yargs.showHelp();
    }
  }

  const config = require('../../lib/config').getMergedConfig();
  const merged = Object.assign({}, argv, parsed, config);
  return runPromise(main(merged));
}

module.exports = {
  command: 'backport <identifier>',
  describe: 'Backport a PR to a release staging branch.',
  builder,
  handler
};
