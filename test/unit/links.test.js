'use strict';

const LinkParser = require('../../lib/links');
const fixtures = require('../fixtures');
const assert = require('assert');
const htmls = fixtures.readJSON('op_html.json');

const expected = [{
  fixes: ['https://github.com/node/issues/16437'],
  refs: ['https://github.com/nodejs/node/pull/15148']
}, {
  fixes: [],
  refs: ['https://github.com/nodejs/node/pull/16293']
}];

describe('CIparser', () => {
  it('should parse CI results', () => {
    for (let i = 0; i < htmls.length; ++i) {
      const op = htmls[i];
      const parser = new LinkParser('node', op);
      const actual = {
        fixes: parser.getFixes(),
        refs: parser.getRefs()
      };
      assert.deepStrictEqual(actual, expected[i]);
    }
  });
});
