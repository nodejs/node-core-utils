'use strict';

const assert = require('assert');
const { ascending, descending } = require('../../lib/comp');

describe('Comparison', () => {
  it('should sort by ascending', () => {
    assert.strictEqual(ascending(0, 1), -1);
    assert.strictEqual(ascending(1, 0), 1);
  });

  it('should sort by descending', () => {
    assert.strictEqual(descending(0, 1), 1);
    assert.strictEqual(descending(1, 0), -1);
  });
});
