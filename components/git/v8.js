import path from 'node:path';

import logSymbols from 'log-symbols';

import { minor, major, backport } from '../../lib/update-v8/index.js';
import { defaultBaseDir } from '../../lib/update-v8/constants.js';
import { checkCwd } from '../../lib/update-v8/common.js';
import { forceRunAsync } from '../../lib/run.js';

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
          type: 'boolean',
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
            type: 'boolean',
            describe: 'Bump V8 embedder version number or patch version',
            default: true
          })
          .option('gpg-sign', {
            alias: 'S',
            type: 'boolean',
            describe: 'GPG-sign commits',
            default: false
          })
          .option('preserve-original-author', {
            type: 'boolean',
            describe: 'Preserve original commit author and date',
            default: true
          })
          .option('squash', {
            type: 'boolean',
            describe:
                'If multiple commits are backported, squash them into one. When ' +
                '`--squash` is passed, `--preserve-original-author` will be ignored',
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
      type: 'boolean',
      describe: 'Enable verbose output',
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
    return forceRunAsync('git', args, {
      ignoreFailure: false,
      input,
      spawnArgs: {
        cwd: options.nodeDir,
        stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit'
      }
    });
  };

  options.execGitV8 = function execGitV8(...args) {
    return forceRunAsync('git', args, {
      ignoreFailure: false,
      captureStdout: true,
      spawnArgs: { cwd: options.v8Dir, stdio: ['ignore', 'pipe', 'inherit'] }
    });
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
