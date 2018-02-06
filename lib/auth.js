'use strict';

const assert = require('assert');
const fs = require('fs');
const { ClientRequest } = require('http');
const { homedir, EOL } = require('os');
const path = require('path');
const util = require('util');
const ghauth = util.promisify(require('ghauth'));
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
let authFile; // ncurc file in $XDG_CONFIG_HOME or ~.
module.exports = lazy(auth);

function check(username, token) {
  assert(typeof username === 'string' && /^[a-zA-Z0-9]*/.test(username));
  assert(typeof token === 'string' && /^[0-9a-f]*/.test(token));
}

async function auth(getCredentials = ghauth) {
  let username, token;
  // Try reading from $XDG_CONFIG_HOME/ncurc, fall back to ~/.ncurc.
  try {
    authFile = path.join(process.env.XDG_CONFIG_HOME, 'ncurc');
    ({ username, token } = JSON.parse(await readFile(authFile, 'utf8')));
  } catch (e) {
    try {
      authFile = path.join(homedir(), '.ncurc');
      ({ username, token } = JSON.parse(await readFile(authFile, 'utf8')));
    } catch (e) {
      process.stdout.write('If this is your first time running this command, ' +
                           'follow the instructions to create an access token' +
                           '. If you prefer to create it yourself on Github, ' +
                           'see https://github.com/nodejs/node-core-utils/blob/master/README.md.' +
                           EOL);
    }
  }

  // If that worked, yay
  if (username && token) {
    check(username, token);
    return Buffer.from(`${username}:${token}`).toString('base64');
  }

  // Ask the user for input, create a token via github v3 API
  // then write to ~/.ncurc and try auth() again
  let credentials;
  try {
    credentials = await getCredentials({
      noSave: true,
      scopes: ['user:email', 'read:org'],
      note: 'node-core-utils CLI tools'
    });
  } catch (e) {
    process.stderr.write(`Could not get token: ${e.message}${EOL}`);
    process.exit(1);
  }

  const json = JSON.stringify({
    username: credentials.user,
    token: credentials.token
  }, null, '  ');
  await writeFile(authFile, json, { mode:
    0o600 /* owner read/write */
  });

  return auth(getCredentials);
}

function lazy(fn) {
  let cachedValue;
  return function(...args) {
    if (cachedValue !== undefined) {
      return cachedValue;
    }
    cachedValue = fn(...args);
    return cachedValue;
  };
}

// This is an ugly hack to get around a bug in hyperquest & ghauth
// which are not currently maintained
const originalSetTimeout = ClientRequest.prototype.setTimeout;
ClientRequest.prototype.setTimeout = function(msecs, ...args) {
  msecs = Math.min(msecs, Math.pow(2, 31) - 1);
  return originalSetTimeout.call(this, msecs, ...args);
};
