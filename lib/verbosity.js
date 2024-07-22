import util from 'node:util';

import chalk from 'chalk';

const VERBOSITY = {
  NONE: 0,
  DEBUG: 2
};

export let verbosity = VERBOSITY.NONE;

export function isDebugVerbosity() {
  return verbosity === VERBOSITY.DEBUG;
};

export function setVerbosityFromEnv() {
  const env = (process.env.NCU_VERBOSITY || '').toUpperCase();
  if (Object.keys(VERBOSITY).includes(env)) {
    verbosity = VERBOSITY[env];
  }
};

export function debuglog(...args) {
  // Prepend a line break in case it's logged while the spinner is running
  console.error(chalk.green(util.format('\n[DEBUG]', ...args)));
};
