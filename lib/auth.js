'use strict';

const assert = require('assert');
const fs = require('fs');
const { ClientRequest } = require('http');
const util = require('util');
const ghauth = util.promisify(require('ghauth'));
const { getMergedConfig, getNcurcPath } = require('./config');

module.exports = lazy(auth);

function check(username, token) {
  assert(typeof username === 'string' && /^[a-zA-Z0-9]*/.test(username));
  assert(typeof token === 'string' && /^[0-9a-f]*/.test(token));
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

async function tryCreateGitHubToken(githubAuth) {
  let credentials;
  try {
    credentials = await githubAuth({
      noSave: true,
      scopes: ['user:email', 'read:org'],
      note: 'node-core-utils CLI tools'
    });
  } catch (e) {
    process.stderr.write(`Could not get token: ${e.message}\n`);
    process.exit(1);
  }
  return credentials;
}

function encode(name, token) {
  return Buffer.from(`${name}:${token}`).toString('base64');
}

// TODO: support jenkins only...or not necessary?
// TODO: make this a class with dependency (CLI) injectable for testing
async function auth(
  options = { github: true },
  githubAuth = ghauth) {
  const result = {};
  if (options.github) {
    let username;
    let token;
    try {
      ({ username, token } = getMergedConfig());
    } catch (e) {
      // Ignore error and prompt
    }

    if (!username || !token) {
      process.stdout.write(
        'If this is your first time running this command, ' +
        'follow the instructions to create an access token' +
        '. If you prefer to create it yourself on Github, ' +
        'see https://github.com/nodejs/node-core-utils/blob/master/README.md.\n');
      const credentials = await tryCreateGitHubToken(githubAuth);
      username = credentials.user;
      token = credentials.token;
      const json = JSON.stringify({ username, token }, null, 2);
      fs.writeFileSync(getNcurcPath(), json, {
        mode: 0o600 /* owner read/write */
      });
      // Try again reading the file
      ({ username, token } = getMergedConfig());
    }
    check(username, token);
    result.github = encode(username, token);
  }

  if (options.jenkins) {
    let { username, jenkins_token } = getMergedConfig();
    if (!username || !jenkins_token) {
      process.stdout.write(
        'Get your Jenkins API token in https://ci.nodejs.org/me/configure ' +
        'and run the following command to add it to your ncu config: ' +
        'ncu-config --global set jenkins_token TOKEN\n');
      process.exit(1);
    };
    check(username, jenkins_token);
    result.jenkins = encode(username, jenkins_token);
  }
  return result;
}

// This is an ugly hack to get around a bug in hyperquest & ghauth
// which are not currently maintained
const originalSetTimeout = ClientRequest.prototype.setTimeout;
ClientRequest.prototype.setTimeout = function(msecs, ...args) {
  msecs = Math.min(msecs, Math.pow(2, 31) - 1);
  return originalSetTimeout.call(this, msecs, ...args);
};
