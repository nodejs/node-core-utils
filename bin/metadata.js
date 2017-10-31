#!/usr/bin/env node
'use strict';

const { EOL } = require('os');
const Request = require('../lib/request');
const auth = require('../lib/auth');
const argv = require('yargs')
.usage('$0 <identifier> [options]', 'Retrieves metadata for a PR and validates them against nodejs/node PR rules')
.detectLocale(false)
.demandCommand(1, 'Pull request identifier (id or URL) is required as first argument.')
.option('o', {
    alias: 'owner',
    demandOption: false,
    default: 'nodejs',
    describe: 'GitHub owner of the PR repository',
    type: 'string'
  })
  .option('r', {
    alias: 'repo',
    demandOption: false,
    default: 'node',
    describe: 'GitHub repository of the PR',
    type: 'string'
  })
  .help('h')
  .alias('h', 'help').argv;

const loggerFactory = require('../lib/logger');
const PRData = require('../lib/pr_data');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

// const REFERENCE_RE = /referenced this pull request in/

let OWNER;
let REPO;
const PR_ID = parsePRId(argv._[0]);

async function main(prid, owner, repo, logger) {
  const credentials = await auth();
  const request = new Request(credentials);

  const data = new PRData(prid, owner, repo, logger, request);
  await data.getAll();

  const metadata = new MetadataGenerator(data).getMetadata();
  const [SCISSOR_LEFT, SCISSOR_RIGHT] = MetadataGenerator.SCISSORS;
  logger.info({
    raw: [SCISSOR_LEFT, metadata, SCISSOR_RIGHT].join(EOL)
  }, 'Generated metadata:');

  if (!process.stdout.isTTY) {
    process.stdout.write(`${metadata}${EOL}`);
  }
  const checker = new PRChecker(logger, data);
  checker.checkAll();
}

const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
const logger = loggerFactory(logStream);
main(PR_ID, OWNER, REPO, logger).catch((err) => {
  logger.error(err);
  process.exit(-1);
});

function parsePRId(id) {
  // Fast path: numeric string
  if (!isNaN(id)) {
    OWNER = argv._[1] || argv.o || 'nodejs';
    REPO = argv._[2] || argv.r || 'node';
    return +id;
  }
  const match = id.match(/^https:\/\/github.com\/(\w+)\/([a-zA-Z.-]+)\/pull\/([0-9]+)(?:\/(?:files)?)?$/);
  if (match !== null) {
    OWNER = match[1];
    REPO = match[2];
    return +match[3];
  }
  throw new Error(`Could not understand PR id format: ${id}`);
}
