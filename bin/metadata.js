#!/usr/bin/env node
'use strict';

const Request = require('../lib/request');
const auth = require('../lib/auth');
const PRData = require('../lib/pr_data');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

const fs = require('fs');

module.exports = async function getMetadata(argv, logger) {
  const { prid, owner, repo } = argv;
  const credentials = await auth();
  const request = new Request(credentials);

  const data = new PRData(prid, owner, repo, logger, request);
  await data.getAll();

  data.logIntro();

  const metadata = new MetadataGenerator(data).getMetadata();
  if (!process.stdout.isTTY) {
    process.stdout.write(metadata);
  }

  if (argv.file) {
    logger.info(`Writing metadata to ${argv.file}`);
    fs.writeFileSync(argv.file, metadata);
  }

  const [SCISSOR_LEFT, SCISSOR_RIGHT] = MetadataGenerator.SCISSORS;
  logger.info({
    raw: `${SCISSOR_LEFT}${metadata}${SCISSOR_RIGHT}`
  }, 'Generated metadata:');

  const checker = new PRChecker(logger, data);
  const status = checker.checkAll();
  return {
    status,
    request,
    data,
    metadata,
    checker
  };
};
