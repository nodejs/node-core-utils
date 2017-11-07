'use strict';

const MetadataGenerator = require('../../lib/metadata_gen');
const {
  fixAndRefPR,
  allGreenReviewers
} = require('../fixtures/data');

const { EOL } = require('os');
const assert = require('assert');
const data = {
  owner: 'nodejs',
  repo: 'node',
  pr: fixAndRefPR,
  reviewers: allGreenReviewers
};

const expected = `PR-URL: https://github.com/nodejs/node/pull/16438
Fixes: https://github.com/nodejs/node/issues/16437
Refs: https://github.com/nodejs/node/pull/15148
Reviewed-By: Foo User <foo@example.com>
Reviewed-By: Quux User <quux@example.com>
Reviewed-By: Baz User <baz@example.com>
Reviewed-By: Bar User <bar@example.com>
`;

describe('MetadataGenerator', () => {
  it('should generate metadata properly', () => {
    const results = new MetadataGenerator(data).getMetadata();
    assert.strictEqual(expected.replace(/\n/g, EOL), results);
  });
});
