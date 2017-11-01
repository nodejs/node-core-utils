'use strict';

const assert = require('assert');

const { readJSON, patchPrototype } = require('../fixtures');
const TestLogger = require('../fixtures/test_logger');

const PRChecker = require('../../lib/pr_checker');
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

const collaborators = require('../fixtures/collaborator_map');
const firstTimerPR = readJSON('first_timer_pr.json');
const semverMajorPR = readJSON('semver_major_pr.json');

describe('PRChecker', () => {
  it('should warn about semver-major PR without enough TSC approvals', () => {
    const logger = new TestLogger();

    const expectedLogs = {
      warn: [
        ['semver-major requires at least two TSC approvals']
      ],
      info: [
        ['Rejections: 0'],
        ['Approvals: 3, 1 from TSC (bar)'],
        ['Bar User(bar)) approved in via LGTM in comments']
      ],
      error: [],
      trace: []
    };

    const checker = new PRChecker(logger,
      semverMajorPR,
      allGreenReviewers,
      commentsWithLGTM,
      approvingReviews,
      simpleCommits,
      collaborators);

    checker.checkReviews();
    assert.deepStrictEqual(logger.logs, expectedLogs);
  });

  it('should warn about PR with rejections & without approvals', () => {
    const logger = new TestLogger();

    const expectedLogs = {
      warn: [
        ['Rejections: 2, 1 from TSC (bar)'],
        ['Foo User(foo)) rejected in https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
        ['Bar User(bar)) rejected in https://github.com/nodejs/node/pull/16438#pullrequestreview-71482624'],
        ['Approvals: 0']
      ],
      info: [],
      error: [],
      trace: []
    };

    const checker = new PRChecker(logger,
      firstTimerPR,
      rejectedReviewers,
      [],
      rejectingReviews,
      simpleCommits,
      collaborators);

    checker.checkReviews();
    assert.deepStrictEqual(logger.logs, expectedLogs);
  });

  it('should warn about PR younger than 72h on weekends', () => {
    const logger = new TestLogger();

    const expectedLogs = {
      warn: [ ['49 hours left to land'] ],
      info: [ ['This PR was created on Fri Oct 27 2017 (weekend in UTC)'] ],
      error: [],
      trace: []
    };

    const now = new Date('2017-10-28T13:00:41.682Z');
    const youngPR = Object.assign({}, firstTimerPR, {
      createdAt: '2017-10-27T14:25:41.682Z'
    });

    const checker = new PRChecker(logger,
      youngPR,
      allGreenReviewers,
      commentsWithLGTM,
      approvingReviews,
      simpleCommits,
      collaborators);

    checker.checkPRWait(now);
    assert.deepStrictEqual(logger.logs, expectedLogs);
  });

  it('should warn about PR younger than 48h on weekdays', () => {
    const logger = new TestLogger();

    const expectedLogs = {
      warn: [ ['22 hours left to land'] ],
      info: [ ['This PR was created on Tue Oct 31 2017 (weekday in UTC)'] ],
      error: [],
      trace: []
    };

    const now = new Date('2017-11-01T14:25:41.682Z');
    const youngPR = Object.assign({}, firstTimerPR, {
      createdAt: '2017-10-31T13:00:41.682Z'
    });

    const checker = new PRChecker(logger,
      youngPR,
      allGreenReviewers,
      commentsWithLGTM,
      approvingReviews,
      simpleCommits,
      collaborators);

    checker.checkPRWait(now);
    assert.deepStrictEqual(logger.logs, expectedLogs);
  });

  it('should warn if no CI runs detected', () => {
    const logger = new TestLogger();

    const expectedLogs = {
      warn: [
        ['No CI runs detected']
      ],
      info: [],
      error: [],
      trace: []
    };

    const checker = new PRChecker(logger,
      firstTimerPR,
      allGreenReviewers,
      commentsWithLGTM,
      approvingReviews,
      simpleCommits,
      collaborators);

    checker.checkCI();
    assert.deepStrictEqual(logger.logs, expectedLogs);
  });

  it('should summarize CI runs detected', () => {
    const logger = new TestLogger();

    const expectedLogs = {
      warn: [],
      info: [
        [
          'Last Full CI on 2017-10-27T04:16:36.458Z: ' +
          'https://ci.nodejs.org/job/node-test-pull-request/10984/'
        ],
        [
          'Last CITGM CI on 2017-10-27T04:16:36.458Z: ' +
          'https://ci.nodejs.org/view/Node.js-citgm/job/citgm-smoker/1030/'
        ],
        [
          'Last libuv CI on 2017-10-24T04:16:36.458Z: ' +
          'https://ci.nodejs.org/view/libuv/job/libuv-test-commit/537/'
        ],
        [
          'Last No Intl CI on 2017-10-23T04:16:36.458Z: ' +
          'https://ci.nodejs.org/job/node-test-commit-linux-nointl/7'
        ],
        [
          'Last V8 CI on 2017-10-22T04:16:36.458Z: ' +
          'https://ci.nodejs.org/job/node-test-commit-v8-linux/1018/'
        ],
        [
          'Last Benchmark CI on 2017-10-21T04:16:36.458Z: ' +
          'https://ci.nodejs.org/job/benchmark-node-micro-benchmarks/20/'
        ],
        [
          'Last Linter CI on 2017-10-22T04:16:36.458Z: ' +
          'https://ci.nodejs.org/job/node-test-linter/13127/'
        ]
      ],
      error: [],
      trace: []
    };

    const checker = new PRChecker(logger,
      firstTimerPR,
      allGreenReviewers,
      commentsWithCI,
      approvingReviews,
      simpleCommits,
      collaborators);

    checker.checkCI();
    assert.deepStrictEqual(logger.logs, expectedLogs);
  });

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
      approvingReviews,
      oddCommits,
      collaborators);

    assert(checker.authorIsNew());
    checker.checkAuthor();
    assert.deepStrictEqual(logger.logs, expectedLogs);
  });
});
