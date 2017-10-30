'use strict';

const { ReviewAnalyzer, Review } = require('../../lib/reviews');
const fixtures = require('../fixtures');
const assert = require('assert');
const { Collaborator } = require('../../lib/collaborators');
const comments = fixtures.readJSON('comments_with_lgtm.json');
const reviews = fixtures.readJSON('reviews_approved.json');
const collaborators = require('../fixtures/collaborator_map');
const approved = fixtures.readJSON('reviewers_approved.json');
approved.forEach((r) => {
  Object.setPrototypeOf(r.reviewer, Collaborator.prototype);
  Object.setPrototypeOf(r.review, Review.prototype);
});

describe('ReviewAnalyzer', () => {
  it('should parse reviews and comments that all approve', () => {
    const analyzer = new ReviewAnalyzer(reviews, comments, collaborators);
    const reviewers = analyzer.getReviewers();

    assert.deepStrictEqual(reviewers, { approved, rejected: [] });
  });
});
