'use strict';

const { readJSON, patchPrototype, readFile } = require('./index');
const { Collaborator } = require('../../lib/collaborators');
const { Review } = require('../../lib/reviews');

const approved = readJSON('reviewers_approved.json');
const requestedChanges = readJSON('reviewers_requested_changes.json');
patchPrototype(approved, 'reviewer', Collaborator.prototype);
patchPrototype(approved, 'review', Review.prototype);
patchPrototype(requestedChanges, 'reviewer', Collaborator.prototype);
patchPrototype(requestedChanges, 'review', Review.prototype);

const allGreenReviewers = {
  approved,
  requestedChanges: []
};
const singleGreenReviewer = {
  approved: [approved[0]],
  requestedChanges: []
};
const requestedChangesReviewers = {
  requestedChanges,
  approved: []
};

const approvingReviews = readJSON('reviews_approved.json');
const requestingChangesReviews = readJSON('reviews_requesting_changes.json');

const commentsWithLiteCI = readJSON('comments_with_lite_ci.json');
const commentsWithCI = readJSON('comments_with_ci.json');
const commentsWithLGTM = readJSON('comments_with_lgtm.json');

const oddCommits = readJSON('odd_commits.json');
const incorrectGitConfigCommits = readJSON('incorrect_git_config_commits.json');
const simpleCommits = readJSON('simple_commits.json');

const singleCommitAfterReview = {
  commits: readJSON('single_commit_after_review_commits.json'),
  reviews: readJSON('single_commit_after_review_reviews.json')
};
const multipleCommitsAfterReview = {
  commits: readJSON('multiple_commits_after_review_commits.json'),
  reviews: readJSON('multiple_commits_after_review_reviews.json')
};
const moreThanThreeCommitsAfterReview = {
  commits: readJSON('more_than_three_commits_after_review_commits.json'),
  reviews: readJSON('more_than_three_commits_after_review_reviews.json')
};

const commitsAfterCi = readJSON('commits_after_ci.json');
const mulipleCommitsAfterCi = readJSON('multiple_commits_after_ci.json');

function makeCollaborators(arr) {
  arr.forEach((c) => {
    Object.setPrototypeOf(c, Collaborator.prototype);
  });
  return new Map(
    arr.map((c) => [c.login.toLowerCase(), c])
  );
}

const collaborators = makeCollaborators(readJSON('collaborators.json'));
const collaboratorsAlternative = makeCollaborators(
  readJSON('collaborators_alternative.json')
);

const firstTimerPR = readJSON('first_timer_pr.json');
const firstTimerPrivatePR = readJSON('first_timer_pr_with_private_email.json');
const semverMajorPR = readJSON('semver_major_pr.json');
const fixAndRefPR = readJSON('pr_with_fixes_and_refs.json');
const fixCrossPR = readJSON('pr_with_fixes_cross.json');
const conflictingPR = readJSON('conflicting_pr.json');
const emptyProfilePR = readJSON('empty_profile_pr.json');
const closedPR = readJSON('./closed_pr.json');
const mergedPR = readJSON('./merged_pr.json');
const readme = readFile('./README/README.md');
const readmeAlternative = readFile('./README/README_alternative.md');
const readmeNoTsc = readFile('./README/README_no_TSC.md');
const readmeNoTscE = readFile('./README/README_no_TSCE.md');
const readmeNoCollaborators = readFile('./README/README_no_collaborators.md');
const readmeNoCollaboratorE = readFile('./README/README_no_collaboratorE.md');
const readmeUnordered = readFile('./README/README_unordered.md');

module.exports = {
  approved,
  requestedChanges,
  allGreenReviewers,
  singleGreenReviewer,
  requestedChangesReviewers,
  approvingReviews,
  requestingChangesReviews,
  commentsWithCI,
  commentsWithLiteCI,
  commentsWithLGTM,
  oddCommits,
  incorrectGitConfigCommits,
  simpleCommits,
  singleCommitAfterReview,
  multipleCommitsAfterReview,
  moreThanThreeCommitsAfterReview,
  commitsAfterCi,
  mulipleCommitsAfterCi,
  collaborators,
  collaboratorsAlternative,
  firstTimerPR,
  firstTimerPrivatePR,
  semverMajorPR,
  fixAndRefPR,
  fixCrossPR,
  conflictingPR,
  emptyProfilePR,
  readme,
  readmeAlternative,
  readmeNoTsc,
  readmeNoTscE,
  readmeNoCollaborators,
  readmeNoCollaboratorE,
  readmeUnordered,
  closedPR,
  mergedPR
};
