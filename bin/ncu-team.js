#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import Request from '../lib/request.js';
import auth from '../lib/auth.js';
import { runPromise } from '../lib/run.js';
import CLI from '../lib/cli.js';
import TeamInfo from '../lib/team_info.js';

import { setVerbosityFromEnv } from '../lib/verbosity.js';

setVerbosityFromEnv();

yargs(hideBin(process.argv)).command({
  command: 'list <team> [org]',
  desc: 'Get the list of members in a team',
  builder: (yargs) => {
    yargs
      .positional('team', {
        describe: 'Name of the team',
        type: 'string'
      })
      .positional('org', {
        describe: 'Name of the organization',
        type: 'string',
        default: 'nodejs'
      });
  },
  handler
})
  .command({
    command: 'sync <file>',
    desc:
      'Synchronize the <!-- ncu-team-sync.team($org/$team) --> block in a file',
    builder: (yargs) => {
      yargs
        .positional('file', {
          describe: 'Path to the file to update',
          type: 'string'
        });
    },
    handler
  })
  .demandCommand(1, 'must provide a valid command')
  .help()
  .parse();

function handler(argv) {
  runPromise(main(argv));
}

async function main(argv) {
  const cli = new CLI();
  const credentials = await auth({
    github: true
  });
  const request = new Request(credentials);

  const [command] = argv._;
  switch (command) {
    case 'list': {
      const info = new TeamInfo(cli, request, argv.org, argv.team);
      await info.listMembers();
      break;
    }
    case 'sync':
      await TeamInfo.syncFile(cli, request, argv.file);
      break;
    default:
      throw new Error(`Unknown command ${command}`);
  }
}
