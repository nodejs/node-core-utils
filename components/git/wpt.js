'use strict';

const fs = require('fs');
const path = require('path');
const Request = require('../../lib/request');
const CLI = require('../../lib/cli');
const auth = require('../../lib/auth');
const { WPTUpdater, HarnessUpdater } = require('../../lib/wpt');
const { runPromise } = require('../../lib/run');

function builder(yargs) {
  return yargs
    .positional('name', {
      describe: 'Subset of the WPT to update, e.g. \'harness\', \'url\'',
      type: 'string'
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

  const statusFolder = path.join(nodedir, 'test', 'wpt', 'status');
  let supported = [];
  if (fs.existsSync(statusFolder)) {
    const jsons = fs.readdirSync(statusFolder);
    supported = jsons.map(item => item.replace('.json', ''));
  } else {
    cli.warn(`Please create the status JSON files in ${statusFolder}`);
  }

  if (name === 'all') {
    updaters.push(new HarnessUpdater(cli, request, nodedir));
    for (const item of supported) {
      updaters.push(new WPTUpdater(item, cli, request, nodedir));
    }
  } else if (name === 'harness') {
    updaters.push(new HarnessUpdater(cli, request, nodedir));
  } else {
    if (!supported.includes(name)) {
      cli.warn(`Please create ${name}.json in ${statusFolder}`);
    }
    updaters.push(new WPTUpdater(name, cli, request, nodedir));
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
