'use strict';

const fs = require('fs');
const path = require('path');
const { EOL } = require('os');
const CLI = require('./cli');

const cwd = process.cwd();
const gitHooksPath = path.join(cwd, '.git/hooks/');
const possibleGitHooks = ['pre-commit'];
const cli = new CLI();

function buildHook(cmd, gitHook) {
  cmd = cmd.join('');
  const hook = [
    '#!/bin/sh',
    'set -e',
    `${cmd} ${gitHook}`,
    'exit $?'
  ];

  return hook.join(EOL);
}

function checkNodeDirectory() {
  if (path.basename(cwd) !== 'node') {
    cli.error('This cmd must be ran in node directory!');
    process.exit(1);
  }
}

// TODO: what if the user already have a pre-commit hook?
function install(hook) {
  checkNodeDirectory();
  cli.startSpinner(`Installing ${hook} git-hook`);
  const hookFile = buildHook`ncu-run-hook ${hook}`;
  const hookFilePath = path.join(cwd, `.git/hooks/${hook}`);
  fs.writeFileSync(hookFilePath, hookFile, {
    encoding: 'utf8',
    mode: 0o777 /* executable */
  });

  // remove .sample files, if left they are known for
  // causing a bug where our installed git hooks will not run
  cli.updateSpinner(`Cleaning up .git/hooks/`);
  const sampleHookFile = `${hookFilePath}.sample`;
  if (fs.existsSync(sampleHookFile)) {
    fs.unlinkSync(sampleHookFile);
  }

  cli.stopSpinner(`${hook} was installed sucessfully`);
}

function uninstall(hook) {
  checkNodeDirectory();
  cli.startSpinner(`Removing ${hook} git-hook`);
  const hookFilePath = path.join(gitHooksPath, hook);

  if (fs.existsSync(hookFilePath)) {
    fs.unlinkSync(hookFilePath);
    cli.stopSpinner(`${hook} git-hook was uninstalled sucessfully`);
  } else {
    const { FAILED } = cli.SPINNER_STATUS;
    cli.stopSpinner(`${hook} is not installed!`, FAILED);
    process.exit(1);
  }
}

module.exports = {
  install,
  uninstall,
  possibleGitHooks
};
