'use strict';

const yargs = require('yargs');
const Request = require('../../lib/request');
const CLI = require('../../lib/cli');
const auth = require('../../lib/auth');
const { WPTUpdater, HarnessUpdater } = require('../../lib/wpt');
const { runPromise } = require('../../lib/run');

// TODO: read this from test/wpt/status/*.json
const SUPPORTED_TESTS = ['url', 'console', 'encoding'];
function builder(yargs) {
  return yargs
    .positional('name', {
      describe: 'Subset of the WPT to update, e.g. \'url\'',
      type: 'string',
      choices: ['all', 'harness'].concat(SUPPORTED_TESTS)
    })
    .options({
      nodedir: {
        describe: 'Path to the node.js project directory',
        type: 'string',
        default: '.'
      }
    });
}

async function main(argv) {
  const { name, nodedir } = argv;
  const cli = new CLI();
  const credentials = await auth({
    github: true
  });
  const request = new Request(credentials);

  const updaters = [];
  if (name === 'all') {
    updaters.push(new HarnessUpdater(cli, request, nodedir));
    for (const item of SUPPORTED_TESTS) {
      updaters.push(new WPTUpdater(item, cli, request, nodedir));
    }
  } else if (SUPPORTED_TESTS.includes(name)) {
    updaters.push(new WPTUpdater(name, cli, request, nodedir));
  } else if (name === 'harness') {
    updaters.push(new HarnessUpdater(cli, request, nodedir));
  } else {
    yargs.showHelp();
    return;
  }

  for (const updater of updaters) {
    await updater.update();
  }
  updaters[0].updateLicense();
}

function handler(argv) {
  runPromise(main(argv));
}

module.exports = {
  command: 'wpt <name>',
  describe: 'Updates WPT suite',
  builder,
  handler
};
