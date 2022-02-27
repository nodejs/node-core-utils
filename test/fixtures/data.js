import { basename } from 'node:path';
import { readdirSync } from 'node:fs';

import { Collaborator } from '../../lib/collaborators.js';
import { Review } from '../../lib/reviews.js';
import { readJSON, patchPrototype, readFile, path } from './index.js';

export const approved = readJSON('reviewers_approved.json');
export const requestedChanges = readJSON('reviewers_requested_changes.json');
patchPrototype(approved, 'reviewer', Collaborator.prototype);
patchPrototype(approved, 'review', Review.prototype);
patchPrototype(requestedChanges, 'reviewer', Collaborator.prototype);
patchPrototype(requestedChanges, 'review', Review.prototype);

export const allGreenReviewers = {
  approved,
  requestedChanges: []
};
export const singleGreenReviewer = {
  approved: [approved[0]],
  requestedChanges: []
};
export const requestedChangesReviewers = {
  requestedChanges,
  approved: []
};

export const noReviewers = {
  requestedChanges: [],
  approved: []
};

export const approvingReviews = readJSON('reviews_approved.json');
export const requestingChangesReviews =
  readJSON('reviews_requesting_changes.json');

export const commentsWithFastTrack = readJSON('comments_with_fast_track.json');
export const commentsWithTwoFastTrack =
  readJSON('comments_with_two_fast_track.json');
export const commentsWithFastTrackInsuffientApprovals =
  readJSON('comments_with_fast_track_insufficient_approvals.json');
export const commentsWithCI = readJSON('comments_with_ci.json');
export const commentsWithFailedCI = readJSON('comments_with_failed_ci.json');
export const commentsWithLGTM = readJSON('comments_with_lgtm.json');
export const commentsWithPendingCI = readJSON('comments_with_pending_ci.json');
export const commentsWithSuccessCI = readJSON('comments_with_success_ci.json');

export const oddCommits = readJSON('odd_commits.json');
export const incorrectGitConfigCommits =
  readJSON('incorrect_git_config_commits.json');
export const simpleCommits = readJSON('simple_commits.json');

export const singleCommitAfterReview = {
  commits: readJSON('single_commit_after_review_commits.json'),
  reviews: readJSON('single_commit_after_review_reviews.json')
};
export const multipleCommitsAfterReview = {
  commits: readJSON('multiple_commits_after_review_commits.json'),
  reviews: readJSON('multiple_commits_after_review_reviews.json')
};
export const moreThanThreeCommitsAfterReview = {
  commits: readJSON('more_than_three_commits_after_review_commits.json'),
  reviews: readJSON('more_than_three_commits_after_review_reviews.json')
};

export const commitsAfterCi = readJSON('commits_after_ci.json');
export const mulipleCommitsAfterCi = readJSON('multiple_commits_after_ci.json');

function makeCollaborators(arr) {
  arr.forEach((c) => {
    Object.setPrototypeOf(c, Collaborator.prototype);
  });
  return new Map(
    arr.map((c) => [c.login.toLowerCase(), c])
  );
}

export const collaborators = makeCollaborators(readJSON('collaborators.json'));
export const collaboratorsAlternative = makeCollaborators(
  readJSON('collaborators_alternative.json')
);

export const firstTimerPR = readJSON('first_timer_pr.json');
export const firstTimerPrivatePR =
  readJSON('first_timer_pr_with_private_email.json');
export const semverMajorPR = readJSON('semver_major_pr.json');
export const fixAndRefPR = readJSON('pr_with_fixes_and_refs.json');
export const fixCrossPR = readJSON('pr_with_fixes_cross.json');
export const duplicateRefPR = readJSON('pr_with_duplicate_refs.json');
export const selfRefPR = readJSON('pr_with_self_ref.json');
export const backportPR = readJSON('pr_with_backport.json');
export const conflictingPR = readJSON('conflicting_pr.json');
export const emptyProfilePR = readJSON('empty_profile_pr.json');
export const closedPR = readJSON('./closed_pr.json');
export const mergedPR = readJSON('./merged_pr.json');
export const readme = readFile('./README/README.md');
export const readmeAlternative = readFile('./README/README_alternative.md');
export const readmeNoTsc = readFile('./README/README_no_TSC.md');
export const readmeNoTscE = readFile('./README/README_no_TSCE.md');
export const readmeNoCollaborators =
  readFile('./README/README_no_collaborators.md');
export const readmeNoCollaboratorE =
  readFile('./README/README_no_collaboratorE.md');
export const readmeUnordered = readFile('./README/README_unordered.md');

export const githubCI = {};

for (const item of readdirSync(path('./github-ci'))) {
  if (!item.endsWith('.json')) {
    continue;
  }
  githubCI[basename(item, '.json')] = readJSON(`./github-ci/${item}`);
};

export const pullRequests = {};

for (const item of readdirSync(path('./pull_requests'))) {
  if (!item.endsWith('.json')) {
    continue;
  }
  pullRequests[basename(item, '.json')] = readJSON(`./pull_requests/${item}`);
};

export const jenkinsCI = {};

for (const subdir of readdirSync(path('./jenkins'))) {
  for (const item of readdirSync(path(`./jenkins/${subdir}`))) {
    if (!item.endsWith('.json')) {
      continue;
    }
    jenkinsCI[`${subdir}/${basename(item, '.json')}`] =
      readJSON(`./jenkins/${subdir}/${item}`);
  }
};
