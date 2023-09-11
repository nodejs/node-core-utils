import path from 'node:path';

import { execa } from 'execa';
import logSymbols from 'log-symbols';

import { minor, major, backport } from '../../lib/update-v8/index.js';
import { defaultBaseDir } from '../../lib/update-v8/constants.js';
import { checkCwd } from '../../lib/update-v8/common.js';

export const command = 'v8 [major|minor|backport]';
export const describe = 'Update or patch the V8 engine';

export function builder(yargs) {
  yargs
    .command({
      command: 'major',
      desc: 'Do a major upgrade. Replaces the whole deps/v8 directory',
      handler,
      builder: (yargs) => {
        yargs.option('branch', {
          describe: 'Branch of the V8 repository to use for the upgrade',
          default: 'lkgr'
        });
        yargs.option('version-bump', {
          describe: 'Bump the NODE_MODULE_VERSION constant',
          default: true
        });
      }
    })
    .command({
      command: 'minor',
      desc: 'Do a minor patch of the current V8 version',
      handler
    })
    .command({
      command: 'backport <sha..>',
      desc: 'Backport one or more commits from the V8 repository',
      handler,
      builder: (yargs) => {
        yargs
          .option('bump', {
            describe: 'Bump V8 embedder version number or patch version',
            default: true
          })
          .option('squash', {
            describe:
                'If multiple commits are backported, squash them into one',
            default: false
          });
      }
    })
    .demandCommand(1, 'Please provide a valid command')
    .option('node-dir', {
      describe: 'Directory of a Node.js clone',
      default: process.cwd()
    })
    .option('base-dir', {
      describe: 'Directory where V8 should be cloned',
      default: defaultBaseDir
    })
    .option('v8-dir', {
      describe: 'Directory of an existing V8 clone'
    })
    .option('verbose', {
      describe: 'Enable verbose output',
      boolean: true,
      default: false
    });
}

export function handler(argv) {
  const options = Object.assign({}, argv);
  options.nodeDir = path.resolve(options.nodeDir);
  options.baseDir = path.resolve(options.baseDir);
  if (!options.v8Dir) {
    options.v8Dir = path.join(options.baseDir, 'v8');
  } else {
    options.v8Dir = path.resolve(options.v8Dir);
  }

  options.execGitNode = function execGitNode(cmd, args, input) {
    args.unshift(cmd);
    return execa('git', args, {
      cwd: options.nodeDir,
      ...input && { input }
    });
  };

  options.execGitV8 = function execGitV8(...args) {
    return execa('git', args, { cwd: options.v8Dir });
  };

  Promise.resolve()
    .then(async() => {
      await checkCwd(options);
      // First element of argv is 'v8'
      const kind = argv._[1];
      options[kind] = true;
      switch (kind) {
        case 'minor':
          return minor(options);
        case 'major':
          return major(options);
        case 'backport':
          return backport(options);
      }
    })
    .catch((err) => {
      console.error(
        logSymbols.error,
        options.verbose ? err.stack : err.message
      );
      process.exitCode = 1;
    });
}
