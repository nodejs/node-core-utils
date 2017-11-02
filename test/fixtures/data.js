'use strict';

const { readJSON, patchPrototype } = require('./index');
const { Collaborator } = require('../../lib/collaborators');
const { Review } = require('../../lib/reviews');

const approved = readJSON('reviewers_approved.json');
const rejected = readJSON('reviewers_rejected.json');
patchPrototype(approved, 'reviewer', Collaborator.prototype);
patchPrototype(approved, 'review', Review.prototype);
patchPrototype(rejected, 'reviewer', Collaborator.prototype);
patchPrototype(rejected, 'review', Review.prototype);

const allGreenReviewers = {
  approved,
  rejected: []
};
const rejectedReviewers = {
  rejected,
  approved: []
};

const approvingReviews = readJSON('reviews_approved.json');
const rejectingReviews = readJSON('reviews_rejected.json');

const commentsWithCI = readJSON('comments_with_ci.json');
const commentsWithLGTM = readJSON('comments_with_lgtm.json');

const oddCommits = readJSON('odd_commits.json');
const simpleCommits = readJSON('simple_commits.json');

const collabArr = readJSON('collaborators.json');

collabArr.forEach((c) => {
  Object.setPrototypeOf(c, Collaborator.prototype);
});
const collaborators = new Map(
  collabArr.map((c) => [c.login.toLowerCase(), c])
);

const firstTimerPR = readJSON('first_timer_pr.json');
const semverMajorPR = readJSON('semver_major_pr.json');
const fixAndRefPR = readJSON('pr_with_fixes_and_refs.json');

module.exports = {
  approved,
  rejected,
  allGreenReviewers,
  rejectedReviewers,
  approvingReviews,
  rejectingReviews,
  commentsWithCI,
  commentsWithLGTM,
  oddCommits,
  simpleCommits,
  collaborators,
  firstTimerPR,
  semverMajorPR,
  fixAndRefPR
};
