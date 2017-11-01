'use strict';

const { ReviewAnalyzer, Review } = require('../../lib/reviews');
const fixtures = require('../fixtures');
const assert = require('assert');
const { Collaborator } = require('../../lib/collaborators');
const comments = fixtures.readJSON('comments_with_lgtm.json');
const approvingReviews = fixtures.readJSON('reviews_approved.json');
const collaborators = require('../fixtures/collaborator_map');
const approved = fixtures.readJSON('reviewers_approved.json');
const rejectingReviews = fixtures.readJSON('reviews_rejected.json');
const rejected = fixtures.readJSON('reviewers_rejected.json');
approved.forEach((r) => {
  Object.setPrototypeOf(r.reviewer, Collaborator.prototype);
  Object.setPrototypeOf(r.review, Review.prototype);
});
rejected.forEach((r) => {
  Object.setPrototypeOf(r.reviewer, Collaborator.prototype);
  Object.setPrototypeOf(r.review, Review.prototype);
});

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
