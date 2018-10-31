'use strict';

const assert = require('assert');
const { ascending, descending } = require('../../lib/utils');

const arr = [
  '2017-10-30T15:47:52Z',
  '2017-10-30T15:19:37Z'
];

describe('Comparison', () => {
  it('should sort by ascending', () => {
    assert.deepStrictEqual(
      ['2017-10-30T15:19:37Z', '2017-10-30T15:47:52Z'],
      arr.sort(ascending)
    );

    assert.strictEqual(ascending(0, 1), -1);
    assert.strictEqual(ascending(1, 0), 1);
  });

  it('should sort by descending', () => {
    assert.deepStrictEqual(
      ['2017-10-30T15:47:52Z', '2017-10-30T15:19:37Z'],
      arr.sort(descending)
    );

    assert.strictEqual(descending(0, 1), 1);
    assert.strictEqual(descending(1, 0), -1);
  });
});
