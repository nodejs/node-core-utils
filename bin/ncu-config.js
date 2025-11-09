#!/usr/bin/env node

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import {
  getConfig, updateConfig, GLOBAL_CONFIG, PROJECT_CONFIG, LOCAL_CONFIG,
  encryptValue
} from '../lib/config.js';
import { setVerbosityFromEnv } from '../lib/verbosity.js';

setVerbosityFromEnv();

const args = yargs(hideBin(process.argv))
  .completion('completion')
  .command({
    command: 'set <key> [<value>]',
    desc: 'Set a config variable',
    builder: (yargs) => {
      yargs
        .option('encrypt', {
          describe: 'Store the value encrypted using gpg',
          alias: 'x',
          type: 'boolean'
        })
        .positional('key', {
          describe: 'key of the configuration',
          type: 'string'
        })
        .positional('value', {
          describe: 'value of the configuration'
        });
    },
    handler: setHandler
  })
  .command({
    command: 'get <key>',
    desc: 'Get a config variable',
    builder: (yargs) => {
      yargs
        .positional('key', {
          describe: 'key of the configuration',
          type: 'string'
        });
    },
    handler: getHandler
  })
  .command({
    command: 'list',
    desc: 'List the configurations',
    handler: listHandler
  })
  .demandCommand(1, 'must provide a valid command')
  // Can't set default of boolean variables if using conflict
  // https://github.com/yargs/yargs/issues/929
  // default: false
  .option('global', {
    alias: 'g',
    type: 'boolean',
    describe: 'Use global config (~/.ncurc)'
  })
  .option('project', {
    alias: 'p',
    type: 'boolean',
    describe: 'Use project config (./.ncurc)'
  })
  .conflicts('global', 'project')
  .help();

function getConfigType(argv) {
  if (argv.global) {
    return { configName: 'global', configType: GLOBAL_CONFIG };
  }
  if (argv.project) {
    return { configName: 'project', configType: PROJECT_CONFIG };
  }
  return { configName: 'local', configType: LOCAL_CONFIG };
}

async function setHandler(argv) {
  const { configName, configType } = getConfigType(argv);
  const config = getConfig(configType);
  if (!argv.value) {
    const rl = readline.createInterface({ input, output });
    argv.value = await rl.question('What value do you want to set? ');
    rl.close();
  } else if (argv.encrypt) {
    console.warn('Passing sensitive config value via the shell is discouraged');
  }
  if (argv.encrypt) {
    argv.value = await encryptValue(argv.value);
  }
  console.log(
    `Updating ${configName} configuration ` +
    `[${argv.key}]: ${config[argv.key]} -> ${argv.value}`);
  updateConfig(configType, { [argv.key]: argv.value });
}

function getHandler(argv) {
  const { configType } = getConfigType(argv);
  const config = getConfig(configType);
  console.log(config[argv.key]);
}

function listHandler(argv) {
  const { configType } = getConfigType(argv);
  const config = getConfig(configType);
  for (const key of Object.keys(config)) {
    console.log(`${key}: ${config[key]}`);
  }
}

const argv = await args.parse();

if (!['get', 'set', 'list'].includes(argv._[0])) {
  args.showHelp();
}
