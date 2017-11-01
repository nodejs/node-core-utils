'use strict';

const { ReviewAnalyzer, Review } = require('../../lib/reviews');
const { readJSON, patchPrototype } = require('../fixtures');
const assert = require('assert');
const { Collaborator } = require('../../lib/collaborators');
const comments = readJSON('comments_with_lgtm.json');
const approvingReviews = readJSON('reviews_approved.json');
const collaborators = require('../fixtures/collaborator_map');
const approved = readJSON('reviewers_approved.json');
const rejectingReviews = readJSON('reviews_rejected.json');
const rejected = readJSON('reviewers_rejected.json');
patchPrototype(approved, 'reviewer', Collaborator.prototype);
patchPrototype(approved, 'review', Review.prototype);
patchPrototype(rejected, 'reviewer', Collaborator.prototype);
patchPrototype(rejected, 'review', Review.prototype);

describe('ReviewAnalyzer', () => {
  it('should parse reviews and comments that all approve', () => {
    const analyzer = new ReviewAnalyzer(approvingReviews,
      comments, collaborators);
    const reviewers = analyzer.getReviewers();

    assert.deepStrictEqual(reviewers, { approved, rejected: [] });
  });

  it('should parse reviews and comments that rejects', () => {
    const analyzer = new ReviewAnalyzer(rejectingReviews, [], collaborators);
    const reviewers = analyzer.getReviewers();

    assert.deepStrictEqual(reviewers, { rejected, approved: [] });
  });
});
