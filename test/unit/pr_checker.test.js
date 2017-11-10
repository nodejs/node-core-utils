'use strict';

const assert = require('assert');
const sinon = require('sinon');

const TestCLI = require('../fixtures/test_cli');

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
  commitsAfterCi,
  collaborators,
  firstTimerPR,
  semverMajorPR,
  conflictingPR
} = require('../fixtures/data');

describe('PRChecker', () => {
  describe('checkAll', () => {
    const cli = new TestCLI();
    const checker = new PRChecker(cli, {
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
    let checkMergeableStateStub;

    before(() => {
      checkReviewsStub = sinon.stub(checker, 'checkReviews');
      checkPRWaitStub = sinon.stub(checker, 'checkPRWait');
      checkCIStub = sinon.stub(checker, 'checkCI');
      authorIsNewStub = sinon.stub(checker, 'authorIsNew').returns(true);
      checkAuthorStub = sinon.stub(checker, 'checkAuthor');
      checkCommitsAfterReviewStub =
        sinon.stub(checker, 'checkCommitsAfterReview');
      checkMergeableStateStub = sinon.stub(checker, 'checkMergeableState');
    });

    after(() => {
      checkReviewsStub.restore();
      checkPRWaitStub.restore();
      checkCIStub.restore();
      authorIsNewStub.restore();
      checkAuthorStub.restore();
      checkCommitsAfterReviewStub.restore();
      checkMergeableStateStub.restore();
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
      assert.strictEqual(checkMergeableStateStub.calledOnce, true);
    });
  });

  describe('checkReviews', () => {
    it('should warn about semver-major PR without enough TSC approvals', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['semver-major requires at least two TSC approvals']
        ],
        ok: [
          ['Rejections: 0'],
          ['Approvals: 4, 1 from TSC (bar)']
        ],
        info: [
          ['- Quux User(Quux) approved in via LGTM in comments'],
          ['- Bar User(bar) approved in via LGTM in comments']
        ]
      };

      const checker = new PRChecker(cli, {
        pr: semverMajorPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkReviews(true);
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn about PR with rejections & without approvals', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['Rejections: 2, 1 from TSC (bar)'],
          ['- Foo User(foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
          ['- Bar User(bar): https://github.com/nodejs/node/pull/16438#pullrequestreview-71482624'],
          ['Approvals: 0']
        ]
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: rejectedReviewers,
        comments: [],
        reviews: rejectingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkReviews();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkPRWait', () => {
    it('should warn about PR younger than 72h on weekends', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        warn: [['49 hours left to land']],
        info: [['This PR was created on Fri Oct 27 2017 (weekend in UTC)']]
      };

      const now = new Date('2017-10-28T13:00:41.682Z');
      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-27T14:25:41.682Z'
      });

      const checker = new PRChecker(cli, {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkPRWait(now);
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn about PR younger than 48h on weekdays', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        warn: [['22 hours left to land']],
        info: [['This PR was created on Tue Oct 31 2017 (weekday in UTC)']]
      };

      const now = new Date('2017-11-01T14:25:41.682Z');
      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-31T13:00:41.682Z'
      });

      const checker = new PRChecker(cli, {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkPRWait(now);
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should skip wait check for Code & Learn PR', () => {
      const cli = new TestCLI();

      const expectedLogs = {};

      const now = new Date();
      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-27T14:25:41.682Z',
        labels: {
          nodes: [
            {
              name: 'code-and-learn'
            }
          ]
        }
      });

      const checker = new PRChecker(cli, {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkPRWait(now);
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkCI', () => {
    it('should warn if no CI runs detected', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['No CI runs detected']
        ]
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators
      });

      const status = checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should summarize CI runs detected', () => {
      const cli = new TestCLI();

      const expectedLogs = {
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
        ]
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithCI,
        reviews: approvingReviews,
        commits: [],
        collaborators
      });

      const status = checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should check commits after last ci', () => {
      const cli = new TestCLI();
      const {commits, comment} = commitsAfterCi;

      const expectedLogs = {
        warn: [
          ['Commits pushed after the last Full CI run:'],
          ['- fixup: adjust spelling'],
          ['- doc: add api description README'],
          ['- feat: add something']
        ],
        info: [
          ['Last Full CI on 2017-10-24T11:19:25Z: https://ci.nodejs.org/job/node-test-pull-request/10984/']
        ]
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: comment,
        reviews: approvingReviews,
        commits: commits,
        collaborators
      });

      const status = checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('authorIsNew/checkAuthor', () => {
    it('should check odd commits for first timers', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        warn: [
          ['PR author is: @pr_author'],
          ['- commit e3ad7c7 is authored by test@example.com'],
          ['- commit da39a3e is authored by test@example.com']
        ]
      };

      const checker = new PRChecker(cli, {
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
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkCommitsAfterReview', () => {
    let cli = new TestCLI();

    afterEach(() => {
      cli.clearCalls();
    });

    it('should warn about commit pushed since the last review', () => {
      const { commits, reviews } = singleCommitAfterReview;

      const expectedLogs = {
        warn: [
          [ 'Changes pushed since the last review:' ],
          [ '- single commit was pushed after review' ]
        ]
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits
      });

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn about multiple commits since the last review', () => {
      const { commits, reviews } = multipleCommitsAfterReview;

      const expectedLogs = {
        warn: [
          [ 'Changes pushed since the last review:' ],
          [ '- src: add requested feature' ],
          [ '- nit: fix errors' ]
        ]
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits
      });

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should skip the check if there are no reviews', () => {
      const { commits } = multipleCommitsAfterReview;

      const expectedLogs = {};

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: [],
        collaborators,
        commits
      });

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, true);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkMergeableState', () => {
    let cli = new TestCLI();

    afterEach(() => {
      cli.clearCalls();
    });

    it('should warn if the PR mergeable state is CONFLICTING', () => {
      const expectedLogs = {
        warn: [['This PR has conflicts that must be resolved']]
      };

      const checker = new PRChecker(cli, {
        pr: conflictingPR,
        reviewers: allGreenReviewers,
        comments: [],
        reviews: [],
        commits: simpleCommits,
        collaborators
      });

      let status = checker.checkMergeableState();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should not warn if the PR mergeable state is not CONFLICTING', () => {
      const { commits } = multipleCommitsAfterReview;

      const expectedLogs = {};

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: [],
        collaborators,
        commits
      });

      let status = checker.checkMergeableState();
      assert.deepStrictEqual(status, true);
      cli.assertCalledWith(expectedLogs);
    });
  });
});
