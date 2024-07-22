import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

let testCounter = 0; // for tmp directories

const FIRST_TIME_MSG =
  'If this is your first time running this command, ' +
  'follow the instructions to create an access token. ' +
  'If you prefer to create it yourself on Github, ' +
  'see https://github.com/nodejs/node-core-utils/blob/main/README.md.';

const MOCKED_TOKEN = JSON.stringify({
  github: 'bnlhbmNhdDowMTIzNDU2Nzg5YWJjZGVm'
});

describe('auth', async function() {
  it('asks for auth data if no ncurc is found', async function() {
    await runAuthScript(
      undefined,
      [FIRST_TIME_MSG, MOCKED_TOKEN]
    );
  });

  it('asks for auth data if ncurc is invalid json', async function() {
    await runAuthScript(
      { HOME: 'this is not json' },
      [FIRST_TIME_MSG, MOCKED_TOKEN]
    );
  });

  it('returns ncurc data if valid in HOME', async function() {
    await runAuthScript(
      { HOME: { username: 'nyancat', token: '0123456789abcdef' } },
      [MOCKED_TOKEN]
    );
  });

  it('returns ncurc data if valid in XDG_CONFIG_HOME', async function() {
    await runAuthScript(
      { HOME: { username: 'nyancat', token: '0123456789abcdef' } },
      [MOCKED_TOKEN]
    );
  });

  it('prefers XDG_CONFIG_HOME/ncurc to HOME/.ncurc', async function() {
    await runAuthScript(
      {
        HOME: { username: 'notnyancat', token: 'somewrongtoken' },
        XDG_CONFIG_HOME: { username: 'nyancat', token: '0123456789abcdef' }
      },
      [MOCKED_TOKEN]
    );
  });

  it("prints an error message if it can't generate a token", async function() {
    await runAuthScript(
      {},
      [FIRST_TIME_MSG],
      'Could not get token: Bad credentials\n', 'run-auth-error'
    );
  });

  it('does not accept a non-string username', async function() {
    await runAuthScript(
      { HOME: { username: {}, token: '0123456789abcdef' } },
      [],
      'username must be a string, received object\n'
    );
  });

  it('does not accept a non-string token', async function() {
    await runAuthScript(
      { HOME: { username: 'nyancat', token: 42 } },
      [],
      'token must be a string, received number\n'
    );
  });

  it('does not accept an invalid username format', async function() {
    await runAuthScript(
      { HOME: { username: ' ^^^ ', token: '0123456789abcdef' } },
      [],
      'username may only contain alphanumeric characters or hyphens, ' +
      'received  ^^^ \n'
    );
  });

  it('does not accept an invalid token format', async function() {
    await runAuthScript(
      { HOME: { username: 'nyancat', token: '@fhqwhgads' } },
      [],
      'token is misformatted: @fhqwhgads\n'
    );
  });

  it('permits capital letters in token format', async function() {
    await runAuthScript(
      { HOME: { username: 'nyancat', token: '0123456789ABCDEF' } },
      ['{"github":"bnlhbmNhdDowMTIzNDU2Nzg5QUJDREVG"}']
    );
  });

  it('permits underscores in token format', async function() {
    await runAuthScript(
      { HOME: { username: 'nyancat', token: 'ghp_0123456789ABCDEF' } },
      ['{"github":"bnlhbmNhdDpnaHBfMDEyMzQ1Njc4OUFCQ0RFRg=="}']
    );
  });
});

// ncurc: { HOME: 'text to put in home ncurc',
//          XDG_CONFIG_HOME: 'text to put in this ncurc' }
function runAuthScript(
  ncurc = {}, expect = [], error = '', fixture = 'run-auth-github') {
  return new Promise((resolve, reject) => {
    const newEnv = { HOME: undefined, XDG_CONFIG_HOME: undefined };
    if (ncurc.HOME === undefined) ncurc.HOME = ''; // HOME must always be set.
    for (const envVar in ncurc) {
      if (ncurc[envVar] === undefined) continue;
      newEnv[envVar] =
        fileURLToPath(new URL(`tmp-${testCounter++}`, import.meta.url));
      fs.rmSync(newEnv[envVar], { recursive: true, force: true });
      fs.mkdirSync(newEnv[envVar], { recursive: true });

      const ncurcPath = path.resolve(newEnv[envVar],
        envVar === 'HOME' ? '.ncurc' : 'ncurc');

      if (ncurc[envVar] !== undefined) {
        if (typeof ncurc[envVar] === 'string') {
          fs.writeFileSync(ncurcPath, ncurc[envVar], 'utf8');
        } else {
          fs.writeFileSync(ncurcPath, JSON.stringify(ncurc[envVar]), 'utf8');
        }
      }
    }
    newEnv.USERPROFILE = newEnv.HOME;

    const proc = spawn(process.execPath,
      [fileURLToPath(new URL(`../fixtures/${fixture}`, import.meta.url))],
      {
        timeout: 1500,
        env: Object.assign({}, process.env, newEnv)
      });
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
        if (newEnv.HOME) {
          fs.rmSync(newEnv.HOME, { recursive: true, force: true });
        }
        if (newEnv.XDG_CONFIG_HOME) {
          fs.rmSync(newEnv.XDG_CONFIG_HOME, { recursive: true, force: true });
        }
      } catch (err) {
        reject(err);
      }
      resolve();
    });

    let pendingStdout = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      pendingStdout += chunk;

      try {
        let newlineIndex;
        while ((newlineIndex = pendingStdout.indexOf('\n')) !== -1) {
          const line = pendingStdout.substr(0, newlineIndex);
          pendingStdout = pendingStdout.substr(newlineIndex + 1);

          onLine(line);
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
      const expected = new RegExp(`^${expect.shift()}$`);

      assert.match(line, expected);
      if (expect.length === 0) {
        proc.stdin.end();
      }
    }
  });
}
