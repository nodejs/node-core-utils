'use strict';

const { EOL } = require('os');
const assert = require('assert');

async function mockCredentials(options) {
  assert.deepStrictEqual(options, {
    noSave: true,
    scopes: ['user:email', 'read:org'],
    note: 'node-core-utils CLI tools'
  });
  return {
    user: 'nyancat',
    token: '0123456789abcdef'
  };
}

(async function() {
  const auth = require('../../lib/auth');
  const authParams = await auth({ github: true }, mockCredentials);
  process.stdout.write(`${JSON.stringify(authParams)}${EOL}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
