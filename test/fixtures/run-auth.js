'use strict';

const assert = require('assert');
const { EOL } = require('os');

async function mockCredentials() {
  return {
    user: 'nyancat',
    token: '0123456789abcdef'
  };
}

(async function() {
  const auth = require('../../lib/auth');
  const authParams = await auth(mockCredentials);
  assert.strictEqual(await auth(mockCredentials), authParams);
  process.stdout.write(`${authParams}${EOL}`);
})();
