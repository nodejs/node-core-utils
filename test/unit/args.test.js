'use strict';

const parseArgs = require('../../lib/args');
const assert = require('assert');

const expected = {
  owner: `nodejs`,
  repo: `node`,
  id: 16637
};

describe('args', async function() {
  describe('Pull ID', async function() {
    it('should return object with default owner and repo if called with numeric argument only',
      async function() {
        let actual = parseArgs('16637');
        await assert.deepStrictEqual(actual, expected);
      });
    it('should return object with default owner and given repo if called with 2 arguments',
      async function() {
        let actual = parseArgs('16637 nodejs.org');
        let modExpected = Object.assign({}, expected);
        modExpected.repo = 'nodejs.org';
        await assert.deepStrictEqual(actual, modExpected);
      });
    it('should return object with given owner and given repo if called with 3 arguments',
      async function() {
        let expect = {
          owner: 'joyeecheung',
          repo: 'node-core-utils',
          id: 41
        };
        let actual = parseArgs('41 joyeecheung node-core-utils');
        await assert.deepStrictEqual(actual, expect);
      });
    it('should return object with given owner and given repo if called with flagged arguments',
      async function() {
        let actual = parseArgs('16637 -o nodejs -r node');
        await assert.deepStrictEqual(actual, expected);
        actual = parseArgs('16637 -r node -o nodejs');
        await assert.deepStrictEqual(actual, expected);
        actual = parseArgs('16637 --owner nodejs --repo node');
        await assert.deepStrictEqual(actual, expected);
        actual = parseArgs('16637 --repo node --owner nodejs');
        await assert.deepStrictEqual(actual, expected);
      });
  });
  describe('Pull URL', async function() {
    it('should return object with parsed arguments when called with url', async function() {
      let actual = parseArgs('https://github.com/nodejs/node/pull/16637');
      await assert.deepStrictEqual(actual, expected);
    });
  });
  describe('Errors', async function() {
    it('should exit and log error when called without arguments', async function() {
      await assert.throws(parseArgs);
    });
    it('should throw when called with a non-url string', async function() {
      let result = () => {
        return parseArgs('dummy');
      };
      await assert.throws(result);
    });
    it('should throw if called with url and other argument', async function() {
      let actual = () => {
        return parseArgs('https://github.com/nodejs/node/pull/16637 nodejs.org');
      };
      await assert.throws(actual);
    });
  });
});
