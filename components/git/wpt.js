import fs from 'node:fs';
import path from 'node:path';

import Request from '../../lib/request.js';
import CLI from '../../lib/cli.js';
import auth from '../../lib/auth.js';
import {
  WPTUpdater,
  ResourcesUpdater,
  InterfacesUpdater
} from '../../lib/wpt/index.js';
import { runPromise } from '../../lib/run.js';

export const command = 'wpt <name>';
export const describe = 'Updates WPT suite';

export function builder(yargs) {
  return yargs
    .positional('name', {
      describe: 'Subset of the WPT to update',
      type: 'string'
    })
    .options({
      commit: {
        describe: 'A specific commit the subset should be updated to',
        type: 'string',
        default: undefined
      },
      nodedir: {
        describe: 'Path to the node.js project directory',
        type: 'string',
        default: '.'
      }
    });
}

async function main(argv) {
  const { name, nodedir, commit } = argv;
  const cli = new CLI();
  const credentials = await auth({
    github: true
  });
  const request = new Request(credentials);

  const updaters = [];

  const statusFolder = path.join(nodedir, 'test', 'wpt', 'status');
  let supported = [
    'dom',
    'html'
  ];
  if (fs.existsSync(statusFolder)) {
    const jsons = fs.readdirSync(statusFolder);
    supported = supported.concat(
      jsons.map(item => item.replace('.json', '')));
  } else {
    cli.warn(`Please create the status JSON files in ${statusFolder}`);
  }

  if (name === 'all' || name === 'resources') {
    updaters.push(new ResourcesUpdater(cli, request, nodedir, commit));
  }
  if (name === 'all' || name === 'interfaces') {
    updaters.push(new InterfacesUpdater(cli, request, nodedir,
      commit, supported));
  }

  if (name === 'all') {
    for (const item of supported) {
      updaters.push(new WPTUpdater(item, cli, request, nodedir, commit));
    }
  } else if (name !== 'resources' && name !== 'interfaces') {
    if (!supported.includes(name)) {
      cli.warn(`Please create ${name}.json in ${statusFolder}`);
    }
    updaters.push(new WPTUpdater(name, cli, request, nodedir, commit));
  }

  for (const updater of updaters) {
    await updater.update();
  }
  updaters[0].updateLicense();
}

export function handler(argv) {
  runPromise(main(argv));
}
