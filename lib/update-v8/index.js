import Enquirer from 'enquirer';
import { Listr } from 'listr2';

import { checkOptions, doBackport } from './backport.js';
import updateVersionNumbers from './updateVersionNumbers.js';
import commitUpdate from './commitUpdate.js';
import majorUpdate from './majorUpdate.js';
import minorUpdate from './minorUpdate.js';
import updateV8Clone from './updateV8Clone.js';

export function major(options) {
  const tasks = new Listr(
    [updateV8Clone(), majorUpdate(), commitUpdate(), updateVersionNumbers()],
    getOptions(options)
  );
  return tasks.run(options);
};

export function minor(options) {
  const tasks = new Listr(
    [updateV8Clone(), minorUpdate(), commitUpdate()],
    getOptions(options)
  );
  return tasks.run(options);
};

export async function backport(options) {
  const shouldStop = await checkOptions(options);
  if (shouldStop) return;
  const tasks = new Listr(
    [updateV8Clone(), doBackport(options)],
    getOptions(options)
  );
  return tasks.run(options);
};

/**
 * Get the listr2 options.
 * @param {{ verbose?: boolean }} options The original options.
 * @return {import('listr2').ListrOptions} The listr2 options.
 */
function getOptions(opts) {
  return {
    renderer: opts.verbose ? 'verbose' : 'default',
    injectWrapper: {
      enquirer: new Enquirer()
    }
  };
}
