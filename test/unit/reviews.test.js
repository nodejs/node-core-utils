'use strict';

const assert = require('assert');
const { ReviewAnalyzer } = require('../../lib/reviews');

const {
  allGreenReviewers,
  requestedChangesReviewers,
  approvingReviews,
  requestingChangesReviews,
  commentsWithLGTM,
  collaborators
} = require('../fixtures/data');

describe('ReviewAnalyzer', () => {
  it('should parse reviews and comments that all approve', () => {
    const analyzer = new ReviewAnalyzer({
      reviews: approvingReviews,
      comments: commentsWithLGTM,
      collaborators
    });
    const reviewers = analyzer.getReviewers();

    assert.deepStrictEqual(reviewers, allGreenReviewers);
  });

  it('should parse reviews and comments that rejects', () => {
    const analyzer = new ReviewAnalyzer({
      reviews: requestingChangesReviews,
      comments: [],
      collaborators
    });
    const reviewers = analyzer.getReviewers();

    assert.deepStrictEqual(reviewers, requestedChangesReviewers);
  });
});
