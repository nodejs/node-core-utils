'use strict';

const chalk = require('chalk');
const util = require('util');

const VERBOSITY = {
  NONE: 0,
  DEBUG: 2
};

let verbosity = VERBOSITY.NONE;

exports.isDebugVerbosity = function() {
  return verbosity === VERBOSITY.DEBUG;
};

exports.setVerbosityFromEnv = function() {
  const env = (process.env.NCU_VERBOSITY || '').toUpperCase();
  if (Object.keys(VERBOSITY).includes(env)) {
    verbosity = VERBOSITY[env];
  }
};

exports.debuglog = function(...args) {
  // Prepend a line break in case it's logged while the spinner is running
  console.error(chalk.green(util.format('\n[DEBUG]', ...args)));
};

exports.VERBOSITY = VERBOSITY;
