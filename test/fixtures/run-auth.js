'use strict';

const assert = require('assert');

(async function() {
  const auth = require('../../lib/auth');
  const authParams = await auth();
  assert.strictEqual(await auth(), authParams);
  console.log(authParams);
})();
