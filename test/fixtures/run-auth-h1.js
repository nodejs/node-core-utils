(async function() {
  const { default: auth } = await import('../../lib/auth.js');
  const authParams = await auth({ github: false });
  if (typeof authParams === 'object' && authParams != null) {
    for (const key of Object.getOwnPropertyNames(authParams)) {
      if (key !== 'h1') delete authParams[key];
    }
  }
  process.stdout.write(`${JSON.stringify(authParams)}\n`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
