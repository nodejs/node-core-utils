'use strict';

const yargs = require('yargs');
const Request = require('../../lib/request');
const CLI = require('../../lib/cli');
const auth = require('../../lib/auth');
const { WPTUpdater, HarnessUpdater } = require('../../lib/wpt');
const { runPromise } = require('../../lib/run');

const SUPPORTED_TESTS = ['url', 'console', 'encoding'];
function builder(yargs) {
  return yargs
    .positional('name', {
      describe: 'Subset of the WPT to update, e.g. \'url\'',
      type: 'string',
      choices: ['harness'].concat(SUPPORTED_TESTS)
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

  let updater;
  if (SUPPORTED_TESTS.includes(name)) {
    updater = new WPTUpdater(name, cli, request, nodedir);
  } else if (name === 'harness') {
    updater = new HarnessUpdater(cli, request, nodedir);
  } else {
    yargs.showHelp();
    return;
  }

  await updater.update();
  await updater.updateLicense();
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
