#!/usr/bin/env node
'use strict';

const argv = require('../lib/args')();
const getMetadata = require('../steps/metadata');
const CLI = require('../lib/cli');

const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
const cli = new CLI(logStream);

getMetadata(argv, cli).catch((err) => {
  if (cli.spinner.enabled) {
    cli.spinner.fail();
  }
  cli.error(err);
  process.exit(-1);
});
