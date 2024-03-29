import fs from 'node:fs';
import { ClientRequest } from 'node:http';

import ghauth from 'ghauth';

import { getMergedConfig, getNcurcPath } from './config.js';

export default lazy(auth);

function errorExit(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function check(username, token) {
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
  if (!/^[A-Za-z0-9_]+$/.test(token)) {
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
        'see https://github.com/nodejs/node-core-utils/blob/main/README.md.\n');
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
    const { username, jenkins_token } = getMergedConfig();
    if (!username || !jenkins_token) {
      errorExit(
        'Get your Jenkins API token in https://ci.nodejs.org/me/configure ' +
        'and run the following command to add it to your ncu config: ' +
        'ncu-config --global set jenkins_token TOKEN'
      );
    };
    check(username, jenkins_token);
    result.jenkins = encode(username, jenkins_token);
  }

  if (options.h1) {
    const { h1_username, h1_token } = getMergedConfig();
    if (!h1_username || !h1_token) {
      errorExit(
        'Get your HackerOne API token in ' +
        'https://docs.hackerone.com/organizations/api-tokens.html ' +
        'and run the following command to add it to your ncu config: ' +
        'ncu-config --global set h1_token TOKEN or ' +
        'ncu-config --global set h1_username USERNAME'
      );
    };
    result.h1 = encode(h1_username, h1_token);
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
