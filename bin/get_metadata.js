#!/usr/bin/env node
'use strict';

const argv = require('../lib/args')();
const getMetadata = require('../steps/metadata');
const loggerFactory = require('../lib/logger');

const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
const logger = loggerFactory(logStream);

getMetadata(argv, logger).catch((err) => {
  logger.error(err);
  process.exit(-1);
});
