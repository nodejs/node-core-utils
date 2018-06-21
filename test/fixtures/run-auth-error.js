'use strict';

async function mockCredentials() {
  throw new Error('Bad credentials');
}

(async function() {
  const auth = require('../../lib/auth');
  await auth({ github: true }, mockCredentials);
})();
