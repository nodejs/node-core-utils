'use strict';
const {
  PENDING, COMMENTED, APPROVED, CHANGES_REQUESTED, DISMISSED
} = require('./review_state');
const { isCollaborator } = require('./collaborators');
const { ascending } = require('./comp');
const LGTM_RE = /^lgtm\W?$/i;
const FROM_REVIEW = 'review';
const FROM_COMMENT = 'comment';
const FROM_REVIEW_COMMENT = 'review_comment';

class Review {
  /**
   * @param {string} state
   * @param {string} date  // ISO date string
   * @param {string} ref
   * @param {string} source
   */
  constructor(state, date, ref, source) {
    this.state = state;
    this.date = date;
    this.ref = ref;
    this.source = source;
  }
}

/**
  * @typedef  {Object} GHReview
  * @property {string} bodyText
  * @property {string} state
  * @property {{login: string}} author
  * @property {string} url
  * @property {string} publishedAt
  *
  * @typedef  {Object} GHComment
  * @property {string} bodyText
  * @property {{login: string}} author
  * @property {string} publishedAt
  *
 */
class ReviewAnalyzer {
  /**
   * @param {PRData} data
   */
  constructor(data) {
    const { reviews, comments, collaborators } = data;
    this.reviews = reviews;
    this.comments = comments;
    this.collaborators = collaborators;
  }

  /**
   * @returns {Map<string, Review>}
   */
  mapByGithubReviews() {
    const map = new Map();
    const collaborators = this.collaborators;
    const list = this.reviews
      .filter((r) => r.state !== PENDING)
      .filter((r) => {
        if (r.state === COMMENTED) {
          return this.isApprovedInComment(r);
        } else {
          return true;
        }
      })
      .filter((r) => {
        return (isCollaborator(collaborators, r.author));
      }).sort((a, b) => {
        return ascending(a.publishedAt, b.publishedAt);
      });

    for (const r of list) {
      const login = r.author.login.toLowerCase();
      const entry = map.get(login);
      if (!entry) {  // initialize
        map.set(
          login,
          new Review(r.state, r.publishedAt, r.url, FROM_REVIEW)
        );
      }
      switch (r.state) {
        case APPROVED:
        case CHANGES_REQUESTED:
          // Overwrite previous reviews, whether initalized or not
          map.set(
            login,
            new Review(r.state, r.publishedAt, r.url, FROM_REVIEW)
          );
          break;
        case COMMENTED:
          map.set(
            login,
            new Review(APPROVED, r.publishedAt, r.bodyText, FROM_REVIEW_COMMENT)
          );
          break;
        case DISMISSED:
          // TODO: check the state of the dismissed review?
          map.delete(login);
          break;
      }
    }
    return map;
  }

  // TODO: count -1 ...? But they should just make it explicit
  /**
   * @param {Map<string, Review>} oldMap
   * @returns {Map<string, Review>}
   */
  updateMapByRawReviews(oldMap) {
    const comments = this.comments;
    const collaborators = this.collaborators;
    const withLgtm = comments.filter((c) => this.hasLGTM(c))
      .filter((c) => {
        return (isCollaborator(collaborators, c.author));
      }).sort((a, b) => {
        return ascending(a.publishedAt, b.publishedAt);
      });

    for (const c of withLgtm) {
      const login = c.author.login.toLowerCase();
      const entry = oldMap.get(login);
      if (!entry || entry.date < c.publishedAt) {
        oldMap.set(
          login,
          // no url, have to use bodyText for refs
          new Review(APPROVED, c.publishedAt, c.bodyText, FROM_COMMENT)
        );
      }
    }
    return oldMap;
  }

  /**
   * @typedef {{reviwewer: Collaborator, review: Review}[]} ReviewerList
   * @returns {{approved: ReviewerList, requestedChanges: ReviewerList}}
   */
  getReviewers() {
    const ghReviews = this.mapByGithubReviews();
    const reviewers = this.updateMapByRawReviews(ghReviews);
    const result = {
      approved: [],
      requestedChanges: []
    };
    const collaborators = this.collaborators;
    for (const [ login, review ] of reviewers) {
      const reviewer = collaborators.get(login.toLowerCase());
      if (review.state === APPROVED) {
        result.approved.push({reviewer, review});
      } else if (review.state === CHANGES_REQUESTED) {
        result.requestedChanges.push({ reviewer, review });
      }
    }
    return result;
  }

  /**
   * @param review
   * @returns {boolean}
   */
  isApprovedInComment(review) {
    return review.state === COMMENTED && this.hasLGTM(review);
  }

  /**
   * @param object
   * @param prop: string
   * @returns {boolean}
   */
  hasLGTM(object) {
    return LGTM_RE.test(object.bodyText.trim());
  }
}

const REVIEW_SOURCES = {
  FROM_COMMENT, FROM_REVIEW, FROM_REVIEW_COMMENT
};

module.exports = {
  ReviewAnalyzer,
  Review,
  REVIEW_SOURCES
};
