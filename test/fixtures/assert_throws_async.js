// async functions never throws, they return rejected promises instead
// so assert.throws doesn't work with them.
// The next allows us to try async error throws

import assert from 'node:assert';

export default async function assertThrowsAsync(fn, regExp) {
  let throwFn = () => {};
  try {
    await fn();
  } catch (e) {
    throwFn = () => { throw e; };
  } finally {
    assert.throws(throwFn, regExp);
  }
};
