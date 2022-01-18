#!/usr/bin/env node

import { readdirSync } from 'fs';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import epilogue from '../components/git/epilogue.js';
import { setVerbosityFromEnv } from '../lib/verbosity.js';

setVerbosityFromEnv();

const commandFiles = readdirSync(new URL('../components/git', import.meta.url))
  .filter(file => file !== 'epilogue.js');

function importCommand(commandFile) {
  return import(new URL(`../components/git/${commandFile}`, import.meta.url));
}

Promise.all(commandFiles.map(importCommand)).then((commands) => {
  const args = yargs(hideBin(process.argv));
  commands.forEach(command => args.command(command));
  args.command('help', false, () => {}, (yargs) => { yargs.showHelp(); })
    .demandCommand(1)
    .strict()
    .epilogue(epilogue)
    .help('help')
    .parse();
});
