async function mockCredentials() {
  throw new Error('Bad credentials');
}

(async function() {
  const { default: auth } = await import('../../lib/auth.js');
  await auth({ github: true }, mockCredentials);
})();
