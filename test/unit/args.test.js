'use strict';

const parseArgs = require('../../lib/args');
const assert = require('assert');

const expected = {
  owner: `nodejs`,
  repo: `node`,
  prid: 16637,
  file: undefined
};

describe('args', async function() {
  describe('Pull ID', async function() {
    it(
      'should return object with default owner and repo ' +
      'if called with numeric argument only',
      async function() {
        const actual = parseArgs('16637');
        assert.deepStrictEqual(actual, expected);
      });

    it(
      'should return object with given owner and given repo ' +
      'if called with flagged arguments',
      async function() {
        let actual = parseArgs('16637 -o nodejs -r node');
        assert.deepStrictEqual(actual, expected);
        actual = parseArgs('16637 -r node -o nodejs');
        assert.deepStrictEqual(actual, expected);
        actual = parseArgs('16637 --owner nodejs --repo node');
        assert.deepStrictEqual(actual, expected);
        actual = parseArgs('16637 --repo node --owner nodejs');
        assert.deepStrictEqual(actual, expected);
      });
  });

  describe('Pull URL', async function() {
    it('should return object with specified file',
      async function() {
        const withFile = Object.assign({}, expected, { file: 'test.txt' });
        let actual = parseArgs('https://github.com/nodejs/node/pull/16637 -f test.txt');
        assert.deepStrictEqual(actual, withFile);
        actual = parseArgs('16637 -f test.txt');
        assert.deepStrictEqual(actual, withFile);
      });
  });

  describe('Pull URL', async function() {
    it('should return object with parsed arguments when called with url',
      async function() {
        const actual = parseArgs('https://github.com/nodejs/node/pull/16637');
        assert.deepStrictEqual(actual, expected);
      });
  });

  describe('Errors', async function() {
    it('should exit and log error when called without arguments',
      async function() {
        assert.throws(parseArgs);
      });

    it('should throw when called with a non-url string',
      async function() {
        const result = () => {
          return parseArgs('dummy');
        };
        assert.throws(result);
      });

    it('should ignore other arguments if called with url',
      async function() {
        const actual = parseArgs('https://github.com/nodejs/node/pull/16637 -o nodejs.org');
        assert.deepStrictEqual(actual, expected);
      });
  });
});
