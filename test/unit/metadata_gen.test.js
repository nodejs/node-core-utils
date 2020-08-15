'use strict';

const MetadataGenerator = require('../../lib/metadata_gen');
const {
  fixAndRefPR,
  selfRefPR,
  duplicateRefPR,
  fixCrossPR,
  backportPR,
  allGreenReviewers
} = require('../fixtures/data');

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

const backportArgv = {
  argv: {
    owner: 'nodejs',
    repo: 'node',
    upstream: 'upstream',
    branch: 'v12.x-staging',
    readme: undefined,
    waitTimeSingleApproval: undefined,
    waitTimeMultiApproval: undefined,
    prid: 30072,
    backport: true
  }
};
const backportData = Object.assign({}, data, { pr: backportPR }, backportArgv);
const backportExpected = `PR-URL: https://github.com/nodejs/node/pull/29995
Backport-PR-URL: https://github.com/nodejs/node/pull/30072
Fixes: https://github.com/nodejs/build/issues/1961
Refs: https://github.com/nodejs/node/commit/53ca0b9ae145c430842bf78e553e3b6cbd2823aa#commitcomment-35494896
`;

const selfRefData = Object.assign({}, data, { pr: selfRefPR });
const selfRefExpected = `PR-URL: https://github.com/nodejs/node/pull/16438
Reviewed-By: Foo User <foo@example.com>
Reviewed-By: Quux User <quux@example.com>
Reviewed-By: Baz User <baz@example.com>
Reviewed-By: Bar User <bar@example.com>
`;

const duplicateRefData = Object.assign({}, data, { pr: duplicateRefPR });
const duplicateRefExpected = `PR-URL: https://github.com/nodejs/node/pull/16438
Refs: https://github.com/nodejs/node/pull/16439
Reviewed-By: Foo User <foo@example.com>
Reviewed-By: Quux User <quux@example.com>
Reviewed-By: Baz User <baz@example.com>
Reviewed-By: Bar User <bar@example.com>
`;

const crossData = Object.assign({}, data, { pr: fixCrossPR });
const crossExpected = `PR-URL: https://github.com/nodejs/node/pull/16438
Fixes: https://github.com/joyeecheung/node-core-utils/issues/123
Reviewed-By: Foo User <foo@example.com>
Reviewed-By: Quux User <quux@example.com>
Reviewed-By: Baz User <baz@example.com>
Reviewed-By: Bar User <bar@example.com>
`;

const skipRefsExpected = `PR-URL: https://github.com/nodejs/node/pull/16438
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

  it('should prevent duplicate references', () => {
    const results = new MetadataGenerator(duplicateRefData).getMetadata();
    assert.strictEqual(duplicateRefExpected, results);
  });

  it('should prevent self-referential references', () => {
    const results = new MetadataGenerator(selfRefData).getMetadata();
    assert.strictEqual(selfRefExpected, results);
  });

  it('should handle cross-owner and cross-repo fixes properly', () => {
    const results = new MetadataGenerator(crossData).getMetadata();
    assert.strictEqual(crossExpected, results);
  });

  it('should generate correct metadata for a backport', () => {
    const backportResults = new MetadataGenerator(backportData).getMetadata();
    assert.strictEqual(backportExpected, backportResults);
  });

  it('should skip adding Fixes/Refs metadata when --skipRefs is passed', () => {
    const data = { skipRefs: true, ...crossData };
    const backportResults = new MetadataGenerator(data).getMetadata();
    assert.strictEqual(skipRefsExpected, backportResults);
  });
});
