import assert from 'node:assert';

import { ReviewAnalyzer } from '../../lib/reviews.js';

import {
  allGreenReviewers,
  requestedChangesReviewers,
  approvingReviews,
  requestingChangesReviews,
  commentsWithLGTM,
  collaborators
} from '../fixtures/data.js';

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
