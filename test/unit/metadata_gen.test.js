'use strict';

const MetadataGenerator = require('../../lib/metadata_gen');
const { readJSON, patchPrototype } = require('../fixtures');
const assert = require('assert');
const { Collaborator } = require('../../lib/collaborators');

const approved = readJSON('reviewers_approved.json');
patchPrototype(approved, 'reviewer', Collaborator.prototype);
const reviewers = { approved, rejected: [] };

const pr = readJSON('pr_with_fixes_and_refs.json');

const expected = `PR-URL: https://github.com/nodejs/node/pull/16438
Fixes: https://github.com/node/issues/16437
Refs: https://github.com/nodejs/node/pull/15148
Reviewed-By: Foo User <foo@gmail.com>
Reviewed-By: Baz User <baz@gmail.com>
Reviewed-By: Bar User <bar@gmail.com>`;

describe('MetadataGenerator', () => {
  it('should generate metadata properly', () => {
    const results = new MetadataGenerator('node', pr, reviewers).getMetadata();
    assert.strictEqual(expected, results);
  });
});
