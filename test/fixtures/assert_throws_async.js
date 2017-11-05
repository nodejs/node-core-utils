// async functions never throws, they return rejected promises instead
// so assert.throws doesn't work with them.
// The next allows us to try async error throws

const assert = require('assert');

const assertThrowsAsync = async(fn, regExp) => {
  let throwFn = () => {};
  try {
    await fn();
  } catch (e) {
    throwFn = () => { throw e; };
  } finally {
    assert.throws(throwFn, regExp);
  }
};

module.exports = assertThrowsAsync;
