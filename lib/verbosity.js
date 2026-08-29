import { format, styleText } from 'node:util';

const VERBOSITY = {
  NONE: 0,
  DEBUG: 2
};

export let verbosity = VERBOSITY.NONE;

export function isDebugVerbosity() {
  return verbosity === VERBOSITY.DEBUG;
}

export function setVerbosityFromEnv() {
  const env = (process.env.NCU_VERBOSITY || '').toUpperCase();
  if (Object.keys(VERBOSITY).includes(env)) {
    verbosity = VERBOSITY[env];
  }
  if (!isDebugVerbosity()) {
    Error.stackTraceLimit = 0;
  }
}

export function debuglog(...args) {
  // Prepend a line break in case it's logged while the spinner is running
  console.error(styleText('green', format('\n[DEBUG]', ...args)));
}
