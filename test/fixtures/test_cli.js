'use strict';

const assert = require('assert');
const CLI = require('../../lib/cli');
const functions = Object.getOwnPropertyNames(CLI.prototype)
  .filter(func => func !== 'constructor');

function newCalls() {
  const calls = {};
  for (const func of functions) {
    calls[func] = [];
  }
  return calls;
}

class TestCLI {
  constructor() {
    this.spinner = {};
    this._calls = newCalls();
  }

  clearCalls() {
    this._calls = newCalls();
  }

  assertCalledWith(calls, msg) {
    const expected = Object.assign(newCalls(), calls);
    assert.deepStrictEqual(this._calls, expected);
  }
}

for (const func of functions) {
  TestCLI.prototype[func] = function(...args) {
    this._calls[func].push(args);
  };
}

for (const key of Object.keys(CLI)) {
  TestCLI[key] = CLI[key];  // constants
}

module.exports = TestCLI;
