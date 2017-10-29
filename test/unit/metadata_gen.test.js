'use strict';

const MetadataGenerator = require('../../lib/metadata_gen');
const fixtures = require('../fixtures');
const assert = require('assert');
const { Collaborator } = require('../../lib/collaborators');

const approved = fixtures.readJSON('reviewers_approved.json');
approved.forEach((r) => {
  Object.setPrototypeOf(r.reviewer, Collaborator.prototype);
});
const reviewers = { approved, rejected: [] };

const pr = fixtures.readJSON('pr_with_fixes_and_refs.json');

const SCISSOR_LEFT = '-------------------------------- >8 ' +
  '--------------------------------';
const SCISSOR_RIGHT = '-------------------------------- 8< ' +
  '--------------------------------';

const expected = `${SCISSOR_LEFT}
PR-URL: https://github.com/nodejs/node/pull/16438
Reviewed-By: Foo User <foo@gmail.com>
Reviewed-By: Baz User <baz@gmail.com>
Reviewed-By: Bar User <bar@gmail.com>
Fixes: https://github.com/node/issues/16437
Refs: https://github.com/nodejs/node/pull/15148
${SCISSOR_RIGHT}`;

describe('MetadataGenerator', () => {
  it('should generate metadata properly', () => {
    const results = new MetadataGenerator('node', pr, reviewers).getMetadata();
    assert.strictEqual(expected, results);
  });
});
