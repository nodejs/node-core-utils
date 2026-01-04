import fs from 'node:fs';
import { ClientRequest } from 'node:http';

import ghauth from 'ghauth';

import { clearCachedConfig, encryptValue, getMergedConfig, getNcurcPath } from './config.js';

export default lazy(auth);

function errorExit(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function check(username, token, format = /^[A-Za-z0-9_]+$/) {
  if (typeof username !== 'string') {
    errorExit(`username must be a string, received ${typeof username}`);
  }
  if (!/^[a-zA-Z0-9-]+$/.test(username)) {
    errorExit(
      'username may only contain alphanumeric characters or hyphens, ' +
      `received ${username}`
    );
  }
  if (typeof token !== 'string') {
    errorExit(`token must be a string, received ${typeof token}`);
  }
  if (!format.test(token)) {
    errorExit(`token is misformatted: ${token}`);
  }
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
      note: 'node-core-utils CLI tools',
      noDeviceFlow: true
    });
  } catch (e) {
    errorExit(`Could not get token: ${e.message}`);
  }
  return credentials;
}

function encode(name, token) {
  return Buffer.from(`${name}:${token}`).toString('base64');
}

function setOwnProperty(target, key, value) {
  return Object.defineProperty(target, key, {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value
  });
}

// TODO: support jenkins only...or not necessary?
// TODO: make this a class with dependency (CLI) injectable for testing
async function auth(
  options = { github: true },
  githubAuth = ghauth) {
  const result = {
    get github() {
      let username;
      let token;
      try {
        ({ username, token } = getMergedConfig());
      } catch (e) {
        // Ignore error and prompt
      }

      check(username, token);
      const github = encode(username, token);
      setOwnProperty(result, 'github', github);
      return github;
    },

    get jenkins() {
      const { username, jenkins_token } = getMergedConfig();
      if (!username || !jenkins_token) {
        errorExit(
          'Get your Jenkins API token in https://ci.nodejs.org/me/security ' +
          'and run the following command to add it to your ncu config: ' +
          'ncu-config --global set -x jenkins_token'
        );
      };
      check(username, jenkins_token);
      const jenkins = encode(username, jenkins_token);
      setOwnProperty(result, 'jenkins', jenkins);
      return jenkins;
    },

    get h1() {
      const { h1_username, h1_token } = getMergedConfig();
      check(h1_username, h1_token, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
      const h1 = encode(h1_username, h1_token);
      setOwnProperty(result, 'h1', h1);
      return h1;
    }
  };
  if (options.github) {
    let config;
    try {
      config = getMergedConfig();
    } catch {
      config = {};
    }
    if (!Object.hasOwn(config, 'token') || !Object.hasOwn(config, 'username')) {
      process.stdout.write(
        'If this is your first time running this command, ' +
        'follow the instructions to create an access token' +
        '. If you prefer to create it yourself on Github, ' +
        'see https://github.com/nodejs/node-core-utils/blob/main/README.md.\n');
      const credentials = await tryCreateGitHubToken(githubAuth);
      const username = credentials.user;
      let token;
      try {
        token = await encryptValue(credentials.token);
      } catch (err) {
        console.warn('Failed encrypt token, storing unencrypted instead');
        token = credentials.token;
      }
      const json = JSON.stringify({ username, token }, null, 2);
      fs.writeFileSync(getNcurcPath(), json, {
        mode: 0o600 /* owner read/write */
      });
      // Try again reading the file
      clearCachedConfig();
    }
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
