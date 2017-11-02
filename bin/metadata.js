#!/usr/bin/env node
'use strict';

const { EOL } = require('os');
const { request, requestAll } = require('../lib/request');
const requestPromise = require('request-promise-native');

const loggerFactory = require('../lib/logger');
const PRData = require('../lib/pr_data');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

// const REFERENCE_RE = /referenced this pull request in/

const PR_ID = parsePRId(process.argv[2]);
const OWNER = process.argv[3] || 'nodejs';
const REPO = process.argv[4] || 'node';

async function main(prid, owner, repo, logger) {
  const req = { request, requestAll, requestPromise };
  const data = new PRData(prid, owner, repo, logger, req);
  await data.getAll();
  data.analyzeReviewers();

  const metadata = new MetadataGenerator(data).getMetadata();
  const [SCISSOR_LEFT, SCISSOR_RIGHT] = MetadataGenerator.SCISSORS;
  logger.info({
    raw: [SCISSOR_LEFT, metadata, SCISSOR_RIGHT].join(EOL)
  }, 'Generated metadata:');

  if (!process.stdout.isTTY) {
    process.stdout.write(`${metadata}${EOL}`);
  }
  /**
   * TODO: put all these data into one object with a class
   */
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
