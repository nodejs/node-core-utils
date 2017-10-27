'use strict';

const CIParser = require('../../lib/ci');
const fixtures = require('../fixtures');
const assert = require('assert');
const comments = fixtures.readJSON('comments_with_ci.json');

const expected = new Map([
  ['FULL', {
    link: 'https://ci.nodejs.org/job/node-test-pull-request/10984/',
    date: '2017-10-27T04:16:36.458Z'
  }],
  ['CITGM', {
    link: 'https://ci.nodejs.org/view/Node.js-citgm/job/citgm-smoker/1030/',
    date: '2017-10-27T04:16:36.458Z'
  }],
  ['LIBUV', {
    link: 'https://ci.nodejs.org/view/libuv/job/libuv-test-commit/537/',
    date: '2017-10-24T04:16:36.458Z'
  }],
  ['NOINTL', {
    link: 'https://ci.nodejs.org/job/node-test-commit-linux-nointl/7',
    date: '2017-10-23T04:16:36.458Z'
  }],
  ['V8', {
    link: 'https://ci.nodejs.org/job/node-test-commit-v8-linux/1018/',
    date: '2017-10-22T04:16:36.458Z'
  }],
  ['BENCHMARK', {
    link: 'https://ci.nodejs.org/job/benchmark-node-micro-benchmarks/20/',
    date: '2017-10-21T04:16:36.458Z'
  }]
]);

describe('CIparser', () => {
  it('should parse CI results', () => {
    const results = new CIParser(comments).parse();
    assert.deepStrictEqual(expected, results);
  });
});
