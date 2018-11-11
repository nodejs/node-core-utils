'use strict';

const path = require('path');

const execa = require('execa');
const logSymbols = require('log-symbols');

const updateV8 = require('../../lib/update-v8');
const constants = require('../../lib/update-v8/constants');
const common = require('../../lib/update-v8/common');

module.exports = {
  command: 'v8 [major|minor|backport]',
  describe: 'Update or patch the V8 engine',
  builder: (yargs) => {
    yargs
      .command({
        command: 'major',
        desc: 'Do a major upgrade. Replaces the whole deps/v8 directory',
        handler: main,
        builder: (yargs) => {
          yargs.option('branch', {
            describe: 'Branch of the V8 repository to use for the upgrade',
            default: 'lkgr'
          });
        }
      })
      .command({
        command: 'minor',
        desc: 'Do a minor patch of the current V8 version',
        handler: main
      })
      .command({
        command: 'backport <sha..>',
        desc: 'Backport one or more commits from the V8 repository',
        handler: main,
        builder: (yargs) => {
          yargs.option('bump', {
            describe: 'Bump V8 embedder version number or patch version',
            default: true
          }).option('squash', {
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
        default: constants.defaultBaseDir
      })
      .option('v8-dir', {
        describe: 'Directory of an existing V8 clone'
      })
      .option('verbose', {
        describe: 'Enable verbose output',
        boolean: true,
        default: false
      });
  },
  handler: main
};

function main(argv) {
  const options = Object.assign({}, argv);
  options.nodeDir = path.resolve(options.nodeDir);
  options.baseDir = path.resolve(options.baseDir);
  if (!options.v8Dir) {
    options.v8Dir = path.join(options.baseDir, 'v8');
  } else {
    options.v8Dir = path.resolve(options.v8Dir);
  }

  options.execGitNode = function execGitNode(...args) {
    return execa('git', args, { cwd: options.nodeDir });
  };
  options.execGitV8 = function execGitV8(...args) {
    return execa('git', args, { cwd: options.v8Dir });
  };

  Promise.resolve()
    .then(async() => {
      await common.checkCwd(options);
      // First element of argv is 'v8'
      const kind = argv._[1];
      options[kind] = true;
      switch (kind) {
        case 'minor':
          return updateV8.minor(options);
        case 'major':
          return updateV8.major(options);
        case 'backport':
          return updateV8.backport(options);
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
