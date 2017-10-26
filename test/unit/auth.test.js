'use strict';

const { spawn } = require('child_process');
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
let testCounter = 0; // for tmp directories

describe('auth', () => {
  it('asks for auth data if no ncurc is found', () => {
    runAuthScript(undefined, [
      'Reading configuration for node-core-utils failed:',
      /ENOENT: no such file or directory, open/,
      'Please enter your Github user information:',
      /Github tokens can be created as described in/,
      { expected: 'Github user name: ', reply: 'nyancat' },
      { expected: 'Github token: ', reply: '0123456789abcdef' },
      'bnlhbmNhdDowMTIzNDU2Nzg5YWJjZGVm'
    ]);
  });

  it('asks for auth data if ncurc is invalid json', () => {
    runAuthScript('this is not json', [
      'Reading configuration for node-core-utils failed:',
      /Unexpected token h in JSON at position 1/,
      'Please enter your Github user information:',
      /Github tokens can be created as described in/,
      { expected: 'Github user name: ', reply: 'nyancat' },
      { expected: 'Github token: ', reply: '0123456789abcdef' },
      'bnlhbmNhdDowMTIzNDU2Nzg5YWJjZGVm'
    ]);
  });

  it('returns ncurc data if it is present and valid', () => {
    runAuthScript({ username: 'nyancat', token: '0123456789abcdef' }, [
      'bnlhbmNhdDowMTIzNDU2Nzg5YWJjZGVm'
    ]);
  });
});

function runAuthScript(ncurc = undefined, expect = []) {
  const HOME = path.resolve(__dirname, `tmp-${testCounter++}`);
  rimraf.sync(HOME);
  mkdirp.sync(HOME);
  const ncurcPath = path.resolve(HOME, '.ncurc');

  if (ncurc !== undefined) {
    if (typeof ncurc === 'string') {
      fs.writeFileSync(ncurcPath, ncurc, 'utf8');
    } else {
      fs.writeFileSync(ncurcPath, JSON.stringify(ncurc), 'utf8');
    }
  }

  const proc = spawn(process.execPath,
    [ require.resolve('../fixtures/run-auth') ],
    // XXX this could just be env: { ...process.env, HOME } but the test loader
    // is complaining?
    { env: Object.assign({}, process.env, { HOME }) });
  let stderr = '';
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => { stderr += chunk; });
  proc.on('close', () => {
    if (stderr) { throw new Error(`unexpected stderr:\n${stderr}`); }
  });

  let pendingStdout = '';
  let flushNotYetTerminatedLineTimeout = null;
  proc.stdout.on('data', (chunk) => {
    pendingStdout += chunk;
    clearTimeout(flushNotYetTerminatedLineTimeout);
    flushNotYetTerminatedLineTimeout = null;

    let newlineIndex;
    while ((newlineIndex = pendingStdout.indexOf('\n')) !== -1) {
      const line = pendingStdout.substr(0, newlineIndex);
      pendingStdout = pendingStdout.substr(newlineIndex + 1);

      onLine(line);
    }

    if (pendingStdout.length > 0) {
      flushNotYetTerminatedLineTimeout = setTimeout(() => {
        onLine(pendingStdout);
        pendingStdout = '';
      }, 100);
    }
  });

  function onLine(line) {
    if (expect.length === 0) { throw new Error(`unexpected stdout line: ${line}`); }
    let expected = expect.shift();
    let reply;
    if (typeof expected.reply === 'string') {
      ({ expected, reply } = expected);
    }
    if (typeof expected === 'string') {
      expected = new RegExp(`^${expected}$`);
    }
    assert(line.match(expected), `${line} should match ${expected}`);
    if (reply !== undefined) {
      proc.stdin.write(`${reply}\n`);
    }
    if (expect.length === 0) { proc.stdin.end(); }
  }
  proc.on('close', () => {
    assert.strictEqual(expect.length, 0);
    rimraf.sync(HOME);
  });
}
