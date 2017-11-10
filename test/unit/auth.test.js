'use strict';

const { spawn } = require('child_process');
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const path = require('path');
const fs = require('fs');
const { EOL } = require('os');
const assert = require('assert');
let testCounter = 0; // for tmp directories

const FIRST_TIME_MSG =
  'If this is your first time running this command, ' +
  'follow the instructions to create an access token. ' +
  'If you prefer to create it yourself on Github, ' +
  'see https://github.com/nodejs/node-core-utils/blob/master/README.md.';

describe('auth', async function() {
  it('asks for auth data if no ncurc is found', async function() {
    this.timeout(2000);
    await runAuthScript(undefined, [
      FIRST_TIME_MSG,
      'bnlhbmNhdDowMTIzNDU2Nzg5YWJjZGVm'
    ]);
  });

  it('asks for auth data if ncurc is invalid json', async function() {
    this.timeout(2000);
    await runAuthScript('this is not json', [
      FIRST_TIME_MSG,
      'bnlhbmNhdDowMTIzNDU2Nzg5YWJjZGVm'
    ]);
  });

  it('returns ncurc data if it is present and valid', async function() {
    this.timeout(2000);
    await runAuthScript({ username: 'nyancat', token: '0123456789abcdef' }, [
      'bnlhbmNhdDowMTIzNDU2Nzg5YWJjZGVm'
    ]);
  });

  it('prints an error message if it can\'t generate a token', async function() {
    this.timeout(2000);
    await runAuthScript(undefined, [
      FIRST_TIME_MSG
    ], `Could not get token: Bad credentials${EOL}`, 'run-auth-error');
  });
});

function runAuthScript(
  ncurc = undefined, expect = [], error = '', fixture = 'run-auth') {
  return new Promise((resolve, reject) => {
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
      [ require.resolve(`../fixtures/${fixture}`) ],
      { timeout: 1500,
        env: Object.assign({}, process.env, { USERPROFILE: HOME, HOME }) });
    let stderr = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (err) => {
      proc.kill();
      reject(err);
    });
    proc.on('close', () => {
      try {
        assert.strictEqual(stderr, error);
        assert.strictEqual(expect.length, 0);
        rimraf.sync(HOME);
      } catch (err) {
        reject(err);
      }
      resolve();
    });

    let pendingStdout = '';
    let flushNotYetTerminatedLineTimeout = null;
    proc.stdout.on('data', (chunk) => {
      pendingStdout += chunk;
      clearTimeout(flushNotYetTerminatedLineTimeout);
      flushNotYetTerminatedLineTimeout = null;

      try {
        let newlineIndex;
        while ((newlineIndex = pendingStdout.indexOf(EOL)) !== -1) {
          const line = pendingStdout.substr(0, newlineIndex);
          pendingStdout = pendingStdout.substr(newlineIndex + EOL.length);

          onLine(line);
        }

        if (pendingStdout.length > 0) {
          flushNotYetTerminatedLineTimeout = setTimeout(() => {
            onLine(pendingStdout);
            pendingStdout = '';
          }, 100);
        }
      } catch (err) {
        proc.kill();
        reject(err);
      }
    });

    function onLine(line) {
      assert.notStrictEqual(
        expect.length,
        0,
        `unexpected stdout line: ${line}`);
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
        proc.stdin.write(`${reply}${EOL}`);
      }
      if (expect.length === 0) {
        proc.stdin.end();
      }
    }
  });
}
