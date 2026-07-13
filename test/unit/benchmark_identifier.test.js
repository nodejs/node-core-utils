import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseIdentifier } from '../../components/git/benchmark.js';

describe('git node benchmark parseIdentifier', () => {
  it('parses a numeric PR id', () => {
    assert.deepStrictEqual(parseIdentifier('12344'), { prid: 12344 });
  });

  it('parses a PR URL', () => {
    assert.deepStrictEqual(
      parseIdentifier('https://github.com/nodejs/node/pull/12344'),
      { owner: 'nodejs', repo: 'node', prid: 12344 });
  });

  it('parses a PR commit URL and captures the commit SHA', () => {
    assert.deepStrictEqual(
      parseIdentifier(
        'https://github.com/aduh95-evals/node-core-utils/pull/2/commits/' +
        'eea2127204972210d1705f2a4d9c25c58b9cf436'),
      {
        owner: 'aduh95-evals',
        repo: 'node-core-utils',
        prid: 2,
        commit: 'eea2127204972210d1705f2a4d9c25c58b9cf436'
      });
  });

  it('returns undefined for an unrecognized identifier', () => {
    assert.strictEqual(parseIdentifier('not-a-pr'), undefined);
  });
});
