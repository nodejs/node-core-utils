'use strict';

const PRChecker = require('../../lib/pr_checker');
const fixtures = require('../fixtures');
const assert = require('assert');
const TestLogger = require('../fixtures/test_logger');
const approved = fixtures.readJSON('reviewers_approved.json');
const allGreenReviewers = {
  approved,
  rejected: []
};
// const commentsWithCI = fixtures.readJSON('comments_with_ci.json');
const commentsWithLGTM = fixtures.readJSON('comments_with_lgtm.json');
const reviews = fixtures.readJSON('reviews_approved.json');
const oddCommits = fixtures.readJSON('odd_commits.json');
const collaborators = require('../fixtures/collaborator_map');

const firstTimerPR = fixtures.readJSON('first_timer_pr.json');

describe('PRChecker', () => {
  it('should check odd commits for first timers', () => {
    const logger = new TestLogger();

    const expectedLogs = {
      warn: [
        ['PR is opened by @pr_author'],
        [ 'Author test@example.com of commit e3ad7c7 ' +
          'does not match committer or PR author' ],
        [ 'Author test@example.com of commit da39a3e ' +
          'does not match committer or PR author']
      ],
      info: [],
      error: [],
      trace: []
    };

    const checker = new PRChecker(logger, firstTimerPR,
      allGreenReviewers,
      commentsWithLGTM,
      reviews,
      oddCommits,
      collaborators);

    assert(checker.authorIsNew());
    checker.checkAuthor();
    assert.deepStrictEqual(logger.logs, expectedLogs);
  });
});
