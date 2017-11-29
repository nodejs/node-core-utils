'use strict';

const LinkParser = require('../../lib/links');
const fixtures = require('../fixtures');
const assert = require('assert');
const htmls = fixtures.readJSON('op_html.json');

const expected = [{
  fixes: ['https://github.com/nodejs/node/issues/16437'],
  refs: ['https://github.com/nodejs/node/pull/15148']
}, {
  fixes: [],
  refs: ['https://github.com/nodejs/node/pull/16293']
}, {
  fixes: ['https://github.com/nodejs/node/issues/16504'],
  refs: []
}, {
  fixes: [],
  refs: ['https://en.wikipedia.org/w/index.php?title=IPv6_address&type=revision&diff=809494791&oldid=804196124']
}];

describe('LinkParser', () => {
  it('should parse fixes and refs', () => {
    for (let i = 0; i < htmls.length; ++i) {
      const op = htmls[i];
      const parser = new LinkParser('nodejs', 'node', op);
      const actual = {
        fixes: parser.getFixes(),
        refs: parser.getRefs()
      };
      assert.deepStrictEqual(actual, expected[i]);
    }
  });
});
