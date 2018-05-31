'use strict';

const MetadataGenerator = require('../../lib/metadata_gen');
const {
  fixAndRefPR,
  fixCrossPR,
  allGreenReviewers
} = require('../fixtures/data');

const assert = require('assert');
const data = {
  owner: 'nodejs',
  repo: 'node',
  pr: fixAndRefPR,
  reviewers: allGreenReviewers
};
const crossData = Object.assign({}, data, { pr: fixCrossPR });

const expected = `PR-URL: https://github.com/nodejs/node/pull/16438
Fixes: https://github.com/nodejs/node/issues/16437
Refs: https://github.com/nodejs/node/pull/15148
Reviewed-By: Foo User <foo@example.com>
Reviewed-By: Quux User <quux@example.com>
Reviewed-By: Baz User <baz@example.com>
Reviewed-By: Bar User <bar@example.com>
`;
const crossExpected = `PR-URL: https://github.com/nodejs/node/pull/16438
Fixes: https://github.com/joyeecheung/node-core-utils/issues/123
Reviewed-By: Foo User <foo@example.com>
Reviewed-By: Quux User <quux@example.com>
Reviewed-By: Baz User <baz@example.com>
Reviewed-By: Bar User <bar@example.com>
`;

describe('MetadataGenerator', () => {
  it('should generate metadata properly', () => {
    const results = new MetadataGenerator(data).getMetadata();
    assert.strictEqual(expected, results);
  });

  it('should handle cross-owner and cross-repo fixes properly', () => {
    const results = new MetadataGenerator(crossData).getMetadata();
    assert.strictEqual(crossExpected, results);
  });
});
