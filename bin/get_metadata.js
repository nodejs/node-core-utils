#!/usr/bin/env node
'use strict';

const argv = require('../lib/args')();
const getMetadata = require('./metadata');
const loggerFactory = require('../lib/logger');

const OWNER = argv.owner;
const REPO = argv.repo;
const PR_ID = argv.id;

const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
const logger = loggerFactory(logStream);

getMetadata(PR_ID, OWNER, REPO, logger).catch((err) => {
  logger.error(err);
  process.exit(-1);
});
