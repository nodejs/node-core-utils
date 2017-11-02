#!/usr/bin/env node
'use strict';

const { EOL } = require('os');
const Request = require('../lib/request');
const auth = require('../lib/auth');

const loggerFactory = require('../lib/logger');
const PRData = require('../lib/pr_data');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

// const REFERENCE_RE = /referenced this pull request in/

const PR_ID = parsePRId(process.argv[2]);
const OWNER = process.argv[3] || 'nodejs';
const REPO = process.argv[4] || 'node';

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
  if (`${+id}` === id) { return +id; }
  const match = id.match(/^https:.*\/pull\/([0-9]+)(?:\/(?:files)?)?$/);
  if (match !== null) { return +match[1]; }
  throw new Error(`Could not understand PR id format: ${id}`);
}
