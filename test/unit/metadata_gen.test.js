'use strict';

const MetadataGenerator = require('../../lib/metadata_gen');
const {
  fixAndRefPR,
  PRWithNoRefsAndFixes,
  allGreenReviewers
} = require('../fixtures/data');

const assert = require('assert');
const data = {
  owner: 'nodejs',
  repo: 'node',
  pr: fixAndRefPR,
  reviewers: allGreenReviewers,
  commits: []
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
    assert.strictEqual(expected, results);
  });

  it('should also genereate fixes and refs from commit msg', () => {
    const commitHTML = `
    <span>Fixes</span>: <a href="https://github.com/nodejs/node/issues/16437" class="issue-link" >#16437</a>
    Refs: <a href="https://github.com/nodejs/node/pull/15148" class="issue-link">#15148</a>
    `;

    const commits = [{
      commit: {
        messageBodyHTML: commitHTML
      }
    }];

    const noFixAndRefData = Object.assign(data, {
      pr: PRWithNoRefsAndFixes,
      commits
    });

    const results = new MetadataGenerator(noFixAndRefData).getMetadata();
    console.log(results);
    assert.strictEqual(expected, results);
  });
});
