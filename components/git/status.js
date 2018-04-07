'use strict';

const path = require('path');
const fs = require('fs');

const { readFile } = require('./../../lib/file');
const { getNcuDir } = require('./../../lib/config');

const CLI = require('../../lib/cli');

const cli = new CLI();
const dir = process.cwd();
const landPath = path.join(getNcuDir(dir), 'land');

function handler(argv) {
  if (fs.existsSync(landPath)) {
    const result = readFile(landPath);
    cli.ok(`Your land status: \n`);
    cli.log(result);
  } else {
    cli.warn("You don't have a land status");
  }
}

module.exports = {
  command: 'status',
  describe: 'Return the status of the current landing',
  handler: handler
};
