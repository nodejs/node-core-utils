'use strict';

const assert = require('assert');
const { ReviewAnalyzer } = require('../../lib/reviews');

const {
  allGreenReviewers,
  rejectedReviewers,
  approvingReviews,
  rejectingReviews,
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
      reviews: rejectingReviews,
      comments: [],
      collaborators
    });
    const reviewers = analyzer.getReviewers();

    assert.deepStrictEqual(reviewers, rejectedReviewers);
  });
});
