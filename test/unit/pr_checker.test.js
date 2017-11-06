'use strict';

const assert = require('assert');
const sinon = require('sinon');

const TestLogger = require('../fixtures/test_logger');

const PRChecker = require('../../lib/pr_checker');

const {
  allGreenReviewers,
  rejectedReviewers,
  approvingReviews,
  rejectingReviews,
  commentsWithCI,
  commentsWithLGTM,
  singleCommitAfterReview,
  multipleCommitsAfterReview,
  oddCommits,
  simpleCommits,
  collaborators,
  firstTimerPR,
  semverMajorPR
} = require('../fixtures/data');

describe('PRChecker', () => {
  describe('checkAll', () => {
    const logger = new TestLogger();
    const checker = new PRChecker(logger, {
      pr: firstTimerPR,
      reviewers: allGreenReviewers,
      comments: commentsWithLGTM,
      reviews: approvingReviews,
      commits: simpleCommits,
      collaborators
    });

    let checkReviewsStub;
    let checkPRWaitStub;
    let checkCIStub;
    let authorIsNewStub;
    let checkAuthorStub;
    let checkCommitsAfterReviewStub;

    before(() => {
      checkReviewsStub = sinon.stub(checker, 'checkReviews');
      checkPRWaitStub = sinon.stub(checker, 'checkPRWait');
      checkCIStub = sinon.stub(checker, 'checkCI');
      authorIsNewStub = sinon.stub(checker, 'authorIsNew').returns(true);
      checkAuthorStub = sinon.stub(checker, 'checkAuthor');
      checkCommitsAfterReviewStub =
        sinon.stub(checker, 'checkCommitsAfterReview');
    });

    after(() => {
      checkReviewsStub.restore();
      checkPRWaitStub.restore();
      checkCIStub.restore();
      authorIsNewStub.restore();
      checkAuthorStub.restore();
      checkCommitsAfterReviewStub.restore();
    });

    it('should run necessary checks', () => {
      const status = checker.checkAll();
      assert.strictEqual(status, false);
      assert.strictEqual(checkReviewsStub.calledOnce, true);
      assert.strictEqual(checkPRWaitStub.calledOnce, true);
      assert.strictEqual(checkCIStub.calledOnce, true);
      assert.strictEqual(authorIsNewStub.calledOnce, true);
      assert.strictEqual(checkAuthorStub.calledOnce, true);
      assert.strictEqual(checkCommitsAfterReviewStub.calledOnce, true);
    });
  });

  describe('checkReviews', () => {
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

      const checker = new PRChecker(logger, {
        pr: semverMajorPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkReviews();
      assert(!status);
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

      const checker = new PRChecker(logger, {
        pr: firstTimerPR,
        reviewers: rejectedReviewers,
        comments: [],
        reviews: rejectingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkReviews();
      assert(!status);
      assert.deepStrictEqual(logger.logs, expectedLogs);
    });
  });

  describe('checkPRWait', () => {
    it('should warn about PR younger than 72h on weekends', () => {
      const logger = new TestLogger();

      const expectedLogs = {
        warn: [['49 hours left to land']],
        info: [['This PR was created on Fri Oct 27 2017 (weekend in UTC)']],
        error: [],
        trace: []
      };

      const now = new Date('2017-10-28T13:00:41.682Z');
      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-27T14:25:41.682Z'
      });

      const checker = new PRChecker(logger, {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkPRWait(now);
      assert(!status);
      assert.deepStrictEqual(logger.logs, expectedLogs);
    });

    it('should warn about PR younger than 48h on weekdays', () => {
      const logger = new TestLogger();

      const expectedLogs = {
        warn: [['22 hours left to land']],
        info: [['This PR was created on Tue Oct 31 2017 (weekday in UTC)']],
        error: [],
        trace: []
      };

      const now = new Date('2017-11-01T14:25:41.682Z');
      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-31T13:00:41.682Z'
      });

      const checker = new PRChecker(logger, {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkPRWait(now);
      assert(!status);
      assert.deepStrictEqual(logger.logs, expectedLogs);
    });
  });

  describe('checkCI', () => {
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

      const checker = new PRChecker(logger, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkCI();
      assert(!status);
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

      const checker = new PRChecker(logger, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithCI,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkCI();
      assert(status);
      assert.deepStrictEqual(logger.logs, expectedLogs);
    });
  });

  describe('authorIsNew/checkAuthor', () => {
    it('should check odd commits for first timers', () => {
      const logger = new TestLogger();

      const expectedLogs = {
        warn: [
          ['PR is opened by @pr_author'],
          ['Author test@example.com of commit e3ad7c7 ' +
            'does not match committer or PR author'],
          ['Author test@example.com of commit da39a3e ' +
            'does not match committer or PR author']
        ],
        info: [],
        error: [],
        trace: []
      };

      const checker = new PRChecker(logger, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: oddCommits,
        collaborators
      });

      assert(checker.authorIsNew());
      const status = checker.checkAuthor();
      assert(!status);
      assert.deepStrictEqual(logger.logs, expectedLogs);
    });
  });

  describe('checkCommitsAfterReview', () => {
    let logger = new TestLogger();

    afterEach(() => {
      logger.clear();
    });

    it('should warn about commit pushed since the last review', () => {
      const { commits, reviews } = singleCommitAfterReview;

      const expectedLogs = {
        warn: [
          [ 'Changes were pushed since the last review:' ],
          [ '- single commit was pushed after review' ]
        ],
        info: [],
        trace: [],
        error: []
      };

      const checker = new PRChecker(logger, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits
      });

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      assert.deepStrictEqual(logger.logs, expectedLogs);
    });

    it('should warn about multiple commits since the last review', () => {
      const { commits, reviews } = multipleCommitsAfterReview;

      const expectedLogs = {
        warn: [
          [ 'Changes were pushed since the last review:' ],
          [ '- src: add requested feature' ],
          [ '- nit: fix errors' ]
        ],
        info: [],
        trace: [],
        error: []
      };

      const checker = new PRChecker(logger, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits
      });

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      assert.deepStrictEqual(logger.logs, expectedLogs);
    });

    it('should skip the check if there are no reviews', () => {
      const { commits } = multipleCommitsAfterReview;

      const expectedLogs = {
        warn: [],
        info: [],
        trace: [],
        error: []
      };

      const checker = new PRChecker(logger, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: [],
        collaborators,
        commits
      });

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, true);
      assert.deepStrictEqual(logger.logs, expectedLogs);
    });
  });
});
