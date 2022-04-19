import assert from 'node:assert';

import { LinkParser, parsePRFromURL } from '../../lib/links.js';

import * as fixtures from '../fixtures/index.js';

const htmls = fixtures.readJSON('op_html.json');

describe('LinkParser', () => {
  it('should parse fixes and refs', () => {
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
      // Parse non-GitHub refs.
      // https://github.com/nodejs/node/pull/17107
      fixes: [],
      refs: ['https://en.wikipedia.org/w/index.php?title=IPv6_address&type=revision&diff=809494791&oldid=804196124']
    }, {
      // Parse npm update pull requests.
      // https://github.com/nodejs/node/pull/42382
      fixes: [],
      refs: []
    }, {
      // Contains `Fixed: v8:11389` which should be ignored.
      // https://github.com/nodejs/node/pull/37276
      fixes: [],
      refs: ['https://bugs.chromium.org/p/v8/issues/detail?id=11389#c18']
    }];

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

  it('should parse PR URL', () => {
    const tests = [{
      input: 'https://github.com/nodejs/node/pull/15148',
      output: {
        owner: 'nodejs',
        repo: 'node',
        prid: 15148
      }
    }, {
      input: 'https://github.com/nodejs/node/pull/15148/files',
      output: {
        owner: 'nodejs',
        repo: 'node',
        prid: 15148
      }
    }, {
      input: 'https://github.com/nodejs/node/pull/15148#pullrequestreview-114058064',
      output: {
        owner: 'nodejs',
        repo: 'node',
        prid: 15148
      }
    }, {
      input: 'https://github.com/foo/bar/pull/1234',
      output: {
        owner: 'foo',
        repo: 'bar',
        prid: 1234
      }
    }, {
      input: 'https://github.com/foo/bar/issues/1234',
      output: undefined
    }, {
      input: '15148',
      output: undefined
    }, {
      input: 15148,
      output: undefined
    }];

    for (const test of tests) {
      const actual = parsePRFromURL(test.input);
      assert.deepStrictEqual(actual, test.output);
    }
  });
});
