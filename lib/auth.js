'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const readline = require('readline');
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const authFile = path.join(os.homedir(), '.ncurc');
module.exports = lazy(auth);

function check(username, token) {
  assert(typeof username === 'string' && /^[a-zA-Z0-9]*/.test(username));
  assert(typeof token === 'string' && /^[0-9a-f]*/.test(token));
}

async function auth() {
  let username, token;
  // Try reading from ~/.ncurc
  try {
    ({ username, token } = JSON.parse(await readFile(authFile, 'utf8')));
  } catch (e) {
    process.stdout.write('Reading configuration for node-core-utils failed:\n' +
                         e.message + '\n');
  }

  // If that worked, yay
  if (username && token) {
    check(username, token);
    return Buffer.from(`${username}:${token}`).toString('base64');
  }

  // Ask the user for input and write to ~/.ncurc, then try again
  process.stdout.write('Please enter your Github user information:\n' +
      '[Github tokens can be created as described in ' +
      'https://help.github.com/articles/' +
      'creating-a-personal-access-token-for-the-command-line/]\n');
  username = await prompt('Github user name');
  token = await prompt('Github token');
  check(username, token);
  const json = JSON.stringify({ username, token }, null, '  ');
  await writeFile(authFile, json, { mode:
    0o600 /* owner read/write */
  });
  return auth();
}

async function prompt(question) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${question}: `);

    const rl = readline.createInterface({
      input: process.stdin
    });
    rl.on('line', (line) => {
      rl.close();
      resolve(line.trim());
    });
    process.stdin.on('error', reject);
    process.stdin.on('end', reject);
  });
}

function lazy(fn) {
  let cachedValue;
  return function() {
    if (cachedValue !== undefined) {
      return cachedValue;
    }
    cachedValue = fn();
    return cachedValue;
  };
}
