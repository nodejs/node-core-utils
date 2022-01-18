import assert from 'assert';

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
  const { default: auth } = await import('../../lib/auth.js');
  const authParams = await auth({ github: true }, mockCredentials);
  process.stdout.write(`${JSON.stringify(authParams)}\n`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
