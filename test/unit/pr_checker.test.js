'use strict';

const assert = require('assert');
const sinon = require('sinon');

const TestCLI = require('../fixtures/test_cli');

const PRChecker = require('../../lib/pr_checker');

const {
  allGreenReviewers,
  requestedChangesReviewers,
  approvingReviews,
  requestingChangesReviews,
  commentsWithCI,
  commentsWithLiteCI,
  commentsWithLGTM,
  singleCommitAfterReview,
  multipleCommitsAfterReview,
  moreThanThreeCommitsAfterReview,
  oddCommits,
  incorrectGitConfigCommits,
  simpleCommits,
  commitsAfterCi,
  mulipleCommitsAfterCi,
  collaborators,
  firstTimerPR,
  firstTimerPrivatePR,
  semverMajorPR,
  conflictingPR,
  closedPR,
  mergedPR
} = require('../fixtures/data');

const argv = { maxCommits: 3 };

describe('PRChecker', () => {
  describe('checkAll', () => {
    const cli = new TestCLI();
    const data = {
      pr: firstTimerPR,
      reviewers: allGreenReviewers,
      comments: commentsWithLGTM,
      reviews: approvingReviews,
      commits: simpleCommits,
      collaborators,
      authorIsNew: () => true
    };
    const checker = new PRChecker(cli, data, argv);

    let checkReviewsStub;
    let checkPRWaitStub;
    let checkCIStub;
    let checkAuthorStub;
    let checkCommitsAfterReviewStub;
    let checkMergeableStateStub;
    let checkPRState;
    let checkGitConfigStub;

    before(() => {
      checkReviewsStub = sinon.stub(checker, 'checkReviews');
      checkPRWaitStub = sinon.stub(checker, 'checkPRWait');
      checkCIStub = sinon.stub(checker, 'checkCI');
      checkAuthorStub = sinon.stub(checker, 'checkAuthor');
      checkCommitsAfterReviewStub =
        sinon.stub(checker, 'checkCommitsAfterReview');
      checkMergeableStateStub = sinon.stub(checker, 'checkMergeableState');
      checkPRState = sinon.stub(checker, 'checkPRState');
      checkGitConfigStub = sinon.stub(checker, 'checkGitConfig');
    });

    after(() => {
      checkReviewsStub.restore();
      checkPRWaitStub.restore();
      checkCIStub.restore();
      checkAuthorStub.restore();
      checkCommitsAfterReviewStub.restore();
      checkMergeableStateStub.restore();
      checkPRState.restore();
      checkGitConfigStub.restore();
    });

    it('should run necessary checks', () => {
      const status = checker.checkAll();
      assert.strictEqual(status, false);
      assert.strictEqual(checkReviewsStub.calledOnce, true);
      assert.strictEqual(checkPRWaitStub.calledOnce, true);
      assert.strictEqual(checkCIStub.calledOnce, true);
      assert.strictEqual(checkAuthorStub.calledOnce, true);
      assert.strictEqual(checkCommitsAfterReviewStub.calledOnce, true);
      assert.strictEqual(checkMergeableStateStub.calledOnce, true);
      assert.strictEqual(checkPRState.calledOnce, true);
      assert.strictEqual(checkGitConfigStub.calledOnce, true);
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
          ['Requested Changes: 0'],
          ['Approvals: 4, 1 from TSC (bar)']
        ],
        info: [
          ['- Quux User(Quux) approved in via LGTM in comments'],
          ['- Bar User(bar) approved in via LGTM in comments']
        ]
      };

      const data = {
        pr: semverMajorPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => false
      };
      const checker = new PRChecker(cli, data, argv);

      const status = checker.checkReviews(true);
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn about PR with rejections & without approvals', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['Requested Changes: 2, 1 from TSC (bar)'],
          ['- Foo User(foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
          ['- Bar User(bar): https://github.com/nodejs/node/pull/16438#pullrequestreview-71482624'],
          ['Approvals: 0']
        ]
      };

      const data = {
        pr: firstTimerPR,
        reviewers: requestedChangesReviewers,
        comments: [],
        reviews: requestingChangesReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

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
        info: [['This PR was created on Sat Oct 28 2017 (weekend in UTC)']]
      };

      const now = new Date('2017-10-29T13:00:41.682Z');
      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-28T14:25:41.682Z'
      });

      const data = {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

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

      const data = {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      const status = checker.checkPRWait(now);
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should log as expected if PR can be fast-tracked', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        info: [
          [ 'This PR is being fast-tracked' ]
        ]
      };

      const now = new Date('2017-11-01T14:25:41.682Z');
      const PR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-31T13:00:41.682Z',
        labels: {
          nodes: [
            { name: 'fast-track' }
          ]
        }
      });

      const data = {
        pr: PR,
        reviewers: allGreenReviewers,
        comments: commentsWithCI,
        reviews: approvingReviews,
        commits: [],
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      checker.checkCI();
      cli.clearCalls();
      const status = checker.checkPRWait(now);
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn about approvals and CI for fast-tracked PR', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        warn: [
          [ 'This PR is being fast-tracked, but awating ' +
          'approvals of 2 contributors and a CI run' ]
        ]
      };

      const now = new Date('2017-11-01T14:25:41.682Z');
      const PR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-31T13:00:41.682Z',
        labels: {
          nodes: [
            { name: 'fast-track' }
          ]
        }
      });

      const data = {
        pr: PR,
        reviewers: requestedChangesReviewers,
        comments: [],
        reviews: requestingChangesReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      checker.checkCI();
      cli.clearCalls();
      const status = checker.checkPRWait(now);
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn cannot be fast-tracked because of approvals', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        warn: [
          [ 'This PR is being fast-tracked, but awating ' +
          'approvals of 2 contributors' ]
        ]
      };

      const now = new Date('2017-11-01T14:25:41.682Z');
      const PR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-31T13:00:41.682Z',
        labels: {
          nodes: [
            { name: 'fast-track' }
          ]
        }
      });

      const data = {
        pr: PR,
        reviewers: requestedChangesReviewers,
        comments: commentsWithCI,
        reviews: approvingReviews,
        commits: [],
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      checker.checkCI();
      cli.clearCalls();
      const status = checker.checkPRWait(now);
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn if the PR has no CI and cannot be fast-tracked', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        warn: [
          [ 'This PR is being fast-tracked, but awating a CI run' ]
        ]
      };

      const now = new Date('2017-11-01T14:25:41.682Z');
      const PR = Object.assign({}, firstTimerPR, {
        createdAt: '2017-10-31T13:00:41.682Z',
        labels: {
          nodes: [
            { name: 'fast-track' }
          ]
        }
      });

      const data = {
        pr: PR,
        reviewers: allGreenReviewers,
        comments: [],
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      checker.checkCI();
      cli.clearCalls();
      const status = checker.checkPRWait(now);
      assert(!status);
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

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

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
          ],
          [
            'Last Lite CI on 2018-02-09T21:38:30Z: ' +
            'https://ci.nodejs.org/job/node-test-commit-lite/246/'
          ]
        ]
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithCI,
        reviews: approvingReviews,
        commits: [],
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      const status = checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should check commits after last ci', () => {
      const cli = new TestCLI();
      const {commits, comment} = commitsAfterCi;

      const expectedLogs = {
        warn: [
          ['Commits were pushed after the last Full CI run:'],
          ['- fixup: adjust spelling'],
          ['- doc: add api description README'],
          ['- feat: add something']
        ],
        info: [
          ['Last Full CI on 2017-10-24T11:19:25Z: https://ci.nodejs.org/job/node-test-pull-request/10984/']
        ]
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: comment,
        reviews: approvingReviews,
        commits: commits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      const status = checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should only log last three commits if multiple', () => {
      const cli = new TestCLI();
      const { commits, comment } = mulipleCommitsAfterCi;

      const expectedLogs = {
        warn: [
          [ 'Commits were pushed after the last Full CI run:' ],
          [ '- doc: add api description README' ],
          [ '- feat: add something' ],
          [ '- style: format code' ],
          [ '...(use `--max-commits 4` to see the full list of commits)' ]
        ],
        info: [
          [
            'Last Full CI on 2017-08-24T11:19:25Z: ' +
            'https://ci.nodejs.org/job/node-test-pull-request/12984/'
          ]
        ],
        error: []
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: comment,
        reviews: approvingReviews,
        commits: commits,
        collaborators,
        authorIsNew: () => true
      }, argv);

      const status = checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should log as expected if passed 0', () => {
      const cli = new TestCLI();
      const { commits, comment } = mulipleCommitsAfterCi;

      const expectedLogs = {
        warn: [
          [ 'Commits were pushed after the last Full CI run:' ],
          [ '...(use `--max-commits 4` to see the full list of commits)' ]
        ],
        info: [
          [
            'Last Full CI on 2017-08-24T11:19:25Z: ' +
            'https://ci.nodejs.org/job/node-test-pull-request/12984/'
          ]
        ],
        error: []
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: comment,
        reviews: approvingReviews,
        commits: commits,
        collaborators,
        authorIsNew: () => true
      }, { maxCommits: 0 });

      const status = checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should count LITE CI as valid ci requirement', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        info: [
          [
            'Last Lite CI on 2018-02-09T21:38:30Z: ' +
            'https://ci.nodejs.org/job/node-test-commit-lite/246/'
          ]
        ]
      };

      const checker = new PRChecker(cli, {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLiteCI,
        reviews: approvingReviews,
        commits: [],
        collaborators,
        authorIsNew: () => true
      }, { maxCommits: 0 });

      const status = checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkAuthor', () => {
    it('should check odd commits for first timers', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        warn: [
          ['PR author is a new contributor: @pr_author(pr_author@example.com)'],
          ['- commit e3ad7c7 is authored by test@example.com'],
          ['- commit da39a3e is authored by test@example.com']
        ]
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: oddCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);
      const status = checker.checkAuthor();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should skip checking odd commits for first timers ' +
      'with private emails', () => {
      const cli = new TestCLI();

      const expectedLogs = {};

      const data = {
        pr: firstTimerPrivatePR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: oddCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);
      const status = checker.checkAuthor();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkGitConfig', () => {
    it('should log an error is user has wrong git config', () => {
      const cli = new TestCLI();
      const expectedLogs = {
        error: [
          [ 'Author does not have correct git config!' ]
        ]
      };

      const data = {
        pr: firstTimerPrivatePR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: incorrectGitConfigCommits,
        collaborators,
        authorIsNew: () => true
      };

      const checker = new PRChecker(cli, data, argv);
      const status = checker.checkGitConfig();

      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should return the status of true if user had correct config', () => {
      const cli = new TestCLI();
      const expectedLogs = {};

      const data = {
        pr: firstTimerPrivatePR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };

      const checker = new PRChecker(cli, data, argv);
      const status = checker.checkGitConfig();

      assert(status);
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
          [ 'Commits were pushed since the last review:' ],
          [ '- src: fix issue with es-modules' ]
        ],
        info: [],
        error: []
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits,
        authorIsNew: () => true
      };

      const checker = new PRChecker(cli, data, argv);

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn about multiple commits since the last review', () => {
      const { commits, reviews } = multipleCommitsAfterReview;

      const expectedLogs = {
        warn: [
          [ 'Commits were pushed since the last review:' ],
          [ '- src: add requested feature' ],
          [ '- nit: edit mistakes' ]
        ],
        info: [],
        error: []
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should only warn last three commits if more than 3 commits', () => {
      const { commits, reviews } = moreThanThreeCommitsAfterReview;
      const expectedLogs = {
        warn: [
          [ 'Commits were pushed since the last review:' ],
          [ '- src: add requested feature' ],
          [ '- nit: edit mistakes' ],
          [ '- final: we should be good to go' ],
          [ '...(use `--max-commits 4` to see the full list of commits)' ]
        ],
        info: [],
        error: []
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should skip the check if there are no reviews', () => {
      const { commits } = multipleCommitsAfterReview;
      const expectedLogs = {};

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: [],
        collaborators,
        commits,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      let status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should return true if PR can be landed', () => {
      const checker = new PRChecker(cli, {
        pr: semverMajorPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      }, argv);

      const status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, true);
    });

    it('should log as expected if passed 1 as flag', () => {
      const { commits, reviews } = moreThanThreeCommitsAfterReview;
      const expectedLogs = {
        warn: [
          [ 'Commits were pushed since the last review:' ],
          [ '- final: we should be good to go' ],
          [ '...(use `--max-commits 4` to see the full list of commits)' ]
        ],
        info: [],
        error: []
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits,
        authorIsNew: () => true
      };

      const checker = new PRChecker(cli, data, { maxCommits: 1 });
      const status = checker.checkCommitsAfterReview();
      cli.assertCalledWith(expectedLogs);
      assert(!status);
    });

    it('should log as expected if passed 0 as flag', () => {
      const { commits, reviews } = moreThanThreeCommitsAfterReview;
      const expectedLogs = {
        warn: [
          [ 'Commits were pushed since the last review:' ],
          [ '...(use `--max-commits 4` to see the full list of commits)' ]
        ],
        info: [],
        error: []
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        collaborators,
        reviews,
        commits,
        authorIsNew: () => true
      };

      const checker = new PRChecker(cli, data, { maxCommits: 0 });
      const status = checker.checkCommitsAfterReview();
      cli.assertCalledWith(expectedLogs);
      assert(!status);
    });
  });

  describe('checkMergeableState', () => {
    let cli = new TestCLI();

    afterEach(() => {
      cli.clearCalls();
    });

    it('should max if the PR mergeable state is CONFLICTING', () => {
      const expectedLogs = {
        warn: [['This PR has conflicts that must be resolved']]
      };

      const data = {
        pr: conflictingPR,
        reviewers: allGreenReviewers,
        comments: [],
        reviews: [],
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      let status = checker.checkMergeableState();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should not warn if the PR mergeable state is not CONFLICTING', () => {
      const { commits } = multipleCommitsAfterReview;
      const expectedLogs = {};

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: [],
        collaborators,
        commits,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, argv);

      let status = checker.checkMergeableState();
      assert.deepStrictEqual(status, true);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkPRStatus - check PR status (closed || merged)', () => {
    let cli = new TestCLI();

    afterEach(() => {
      cli.clearCalls();
    });

    it('should warn if PR is closed', () => {
      const expectedLogs = {
        warn: [
          [ 'This PR is closed' ]
        ]
      };

      const data = {
        pr: closedPR,
        reviewers: allGreenReviewers,
        comments: [],
        reviews: [],
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };

      const checker = new PRChecker(cli, data, argv);
      const status = checker.checkPRState();
      assert.strictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn if PR is merged', () => {
      const expectedLogs = {
        warn: [
          [ 'This PR is merged' ]
        ]
      };

      const data = {
        pr: mergedPR,
        reviewers: allGreenReviewers,
        comments: [],
        reviews: [],
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };

      const checker = new PRChecker(cli, data, argv);
      const status = checker.checkPRState();
      assert.strictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should return true if pr is not closed or merged', () => {
      const expectedLogs = {};

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: [],
        reviews: [],
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };

      const checker = new PRChecker(cli, data, argv);
      const status = checker.checkPRState();
      assert.strictEqual(status, true);
      cli.assertCalledWith(expectedLogs);
    });
  });
});
