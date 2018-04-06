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
    this.SPINNER_STATUS = CLI.SPINNER_STATUS;
  }

  clearCalls() {
    this._calls = newCalls();
  }

  assertCalledWith(calls, options = {}) {
    const expected = Object.assign(newCalls(), calls);
    const actual = {};
    const ignore = options.ignore || [];
    for (const func of Object.keys(this._calls)) {
      if (!ignore.includes(func)) {
        actual[func] = this._calls[func];
      } else {
        actual[func] = [];
      }
    }
    assert.deepStrictEqual(actual, expected);
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
