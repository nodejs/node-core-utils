'use strict';

const assert = require('assert');
const sinon = require('sinon');

const TestCLI = require('../fixtures/test_cli');

const PRData = require('../../lib/pr_data');
const PRChecker = require('../../lib/pr_checker');

const GT_7D = '2018-11-23T17:50:44.477Z';
const LT_7D_GT_48H = '2018-11-27T17:50:44.477Z';
const LT_48H = '2018-11-30T17:50:44.477Z';
const LT_48H_GT_47H = '2018-11-29T17:55:44.477Z';
const NOW = '2018-11-31T17:50:44.477Z';

const {
  allGreenReviewers,
  singleGreenReviewer,
  requestedChangesReviewers,
  approvingReviews,
  githubCI,
  requestingChangesReviews,
  noReviewers,
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
      authorIsNew: () => true,
      getThread() {
        return PRData.prototype.getThread.call(this);
      }
    };
    const checker = new PRChecker(cli, data, {}, argv);

    let checkReviewsAndWaitStub;
    let checkCIStub;
    let checkAuthorStub;
    let checkCommitsAfterReviewStub;
    let checkMergeableStateStub;
    let checkPRState;
    let checkGitConfigStub;

    before(() => {
      checkReviewsAndWaitStub = sinon.stub(checker, 'checkReviewsAndWait');
      checkCIStub = sinon.stub(checker, 'checkCI');
      checkAuthorStub = sinon.stub(checker, 'checkAuthor');
      checkCommitsAfterReviewStub =
        sinon.stub(checker, 'checkCommitsAfterReview');
      checkMergeableStateStub = sinon.stub(checker, 'checkMergeableState');
      checkPRState = sinon.stub(checker, 'checkPRState');
      checkGitConfigStub = sinon.stub(checker, 'checkGitConfig');
    });

    after(() => {
      checkReviewsAndWaitStub.restore();
      checkCIStub.restore();
      checkAuthorStub.restore();
      checkCommitsAfterReviewStub.restore();
      checkMergeableStateStub.restore();
      checkPRState.restore();
      checkGitConfigStub.restore();
    });

    it('should run necessary checks', async() => {
      const status = await checker.checkAll();
      assert.strictEqual(status, false);
      assert.strictEqual(checkReviewsAndWaitStub.calledOnce, true);
      assert.strictEqual(checkCIStub.calledOnce, true);
      assert.strictEqual(checkAuthorStub.calledOnce, true);
      assert.strictEqual(checkCommitsAfterReviewStub.calledOnce, true);
      assert.strictEqual(checkMergeableStateStub.calledOnce, true);
      assert.strictEqual(checkPRState.calledOnce, true);
      assert.strictEqual(checkGitConfigStub.calledOnce, true);
    });
  });

  describe('checkReviewsAndWait', () => {
    it('should error when semver-major PR has only 1 TSC approval', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['semver-major requires at least 2 TSC approvals']
        ],
        ok: [
          ['Approvals: 4'],
          ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
          ['- Quux User (@Quux): LGTM'],
          ['- Baz User (@Baz): https://github.com/nodejs/node/pull/16438#pullrequestreview-71488236'],
          ['- Bar User (@bar) (TSC): lgtm']
        ],
        info: [
          ['This PR was created on Fri, 23 Nov 2018 17:50:44 GMT'],
          ['- Quux User (@Quux) approved in via LGTM in comments'],
          ['- Bar User (@bar) approved in via LGTM in comments']
        ]
      };
      const pr = Object.assign({}, semverMajorPR, {
        createdAt: GT_7D
      });

      const data = {
        pr,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => false,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkReviewsAndWait(new Date(NOW), true);
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error when PR has change requests', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['Requested Changes: 2'],
          ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
          ['- Bar User (@bar) (TSC): https://github.com/nodejs/node/pull/16438#pullrequestreview-71482624'],
          ['Approvals: 0']
        ],
        info: [
          ['This PR was created on Fri, 23 Nov 2018 17:50:44 GMT']
        ]
      };

      const pr = Object.assign({}, firstTimerPR, {
        createdAt: GT_7D
      });

      const data = {
        pr,
        reviewers: requestedChangesReviewers,
        comments: [],
        reviews: requestingChangesReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error when PR is younger than 48h', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        ok:
         [['Approvals: 4'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
           ['- Quux User (@Quux): LGTM'],
           ['- Baz User (@Baz): https://github.com/nodejs/node/pull/16438#pullrequestreview-71488236'],
           ['- Bar User (@bar) (TSC): lgtm']],
        info: [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT']],
        error: [['This PR needs to wait 24 more hours to land']]
      };

      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H
      });

      const data = {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should succeed if waitTimeMultiApproval is set', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        ok:
         [['Approvals: 4'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
           ['- Quux User (@Quux): LGTM'],
           ['- Baz User (@Baz): https://github.com/nodejs/node/pull/16438#pullrequestreview-71488236'],
           ['- Bar User (@bar) (TSC): lgtm']],
        info: [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT']]
      };

      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H
      });

      const data = {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, {
        waitTimeMultiApproval: 23
      });

      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error when PR is younger than 48h and older than 47h', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        ok:
         [['Approvals: 4'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
           ['- Quux User (@Quux): LGTM'],
           ['- Baz User (@Baz): https://github.com/nodejs/node/pull/16438#pullrequestreview-71488236'],
           ['- Bar User (@bar) (TSC): lgtm']],
        info: [['This PR was created on Thu, 29 Nov 2018 17:55:44 GMT']],
        error: [['This PR needs to wait 5 more minutes to land']]
      };

      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H_GT_47H
      });

      const data = {
        pr: youngPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error when PR has only 1 approval < 48h', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        ok:
         [['Approvals: 1'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624']],
        info:
         [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT']],
        error: [['This PR needs to wait 144 more hours to land ' +
                   '(or 24 hours if there is one more approval)']]
      };

      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H
      });

      const data = {
        pr: youngPR,
        reviewers: singleGreenReviewer,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error when PR has only 1 approval >48h', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        ok:
        [['Approvals: 1'],
          ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624']],
        info:
        [['This PR was created on Tue, 27 Nov 2018 17:50:44 GMT']],
        error: [['This PR needs to wait 72 more hours to land ' +
                   '(or 0 hours if there is one more approval)']]
      };

      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: LT_7D_GT_48H
      });

      const data = {
        pr: youngPR,
        reviewers: singleGreenReviewer,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should succeed with 1 approval with waitTimeSingleApproval set', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        ok:
         [['Approvals: 1'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624']],
        info:
         [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT']]
      };

      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H
      });

      const data = {
        pr: youngPR,
        reviewers: singleGreenReviewer,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, {
        waitTimeSingleApproval: 0
      });

      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error with 0 approval and waitTimeSingleApproval=0', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        info:
         [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT']],
        error:
         [['Approvals: 0']]
      };

      const youngPR = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H
      });

      const data = {
        pr: youngPR,
        reviewers: noReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, {
        waitTimeSingleApproval: 0
      });

      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should log as expected if PR can be fast-tracked', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        ok:
         [['Approvals: 4'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
           ['- Quux User (@Quux): LGTM'],
           ['- Baz User (@Baz): https://github.com/nodejs/node/pull/16438#pullrequestreview-71488236'],
           ['- Bar User (@bar) (TSC): lgtm']],
        info:
         [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT'],
           ['This PR is being fast-tracked']]
      };

      const pr = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H,
        labels: {
          nodes: [
            { name: 'fast-track' }
          ]
        }
      });

      const data = {
        pr,
        reviewers: allGreenReviewers,
        comments: commentsWithCI,
        reviews: approvingReviews,
        commits: [],
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      cli.clearCalls();
      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should fast track code-and-learn PRs', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        ok:
         [['Approvals: 4'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
           ['- Quux User (@Quux): LGTM'],
           ['- Baz User (@Baz): https://github.com/nodejs/node/pull/16438#pullrequestreview-71488236'],
           ['- Bar User (@bar) (TSC): lgtm']],
        info:
         [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT'],
           ['This PR is being fast-tracked because ' +
             'it is from a Code and Learn event']
         ]
      };

      const pr = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H,
        labels: {
          nodes: [
            { name: 'code-and-learn' }
          ]
        }
      });

      const data = {
        pr,
        reviewers: allGreenReviewers,
        comments: commentsWithCI,
        reviews: approvingReviews,
        commits: [],
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      cli.clearCalls();
      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn about approvals and CI for fast-tracked PR', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        info:
         [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT'],
           ['This PR is being fast-tracked']],
        error:
         [['Requested Changes: 2'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
           ['- Bar User (@bar) (TSC): https://github.com/nodejs/node/pull/16438#pullrequestreview-71482624'],
           ['Approvals: 0']]
      };

      const pr = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H,
        labels: {
          nodes: [
            { name: 'fast-track' }
          ]
        }
      });

      const data = {
        pr,
        reviewers: requestedChangesReviewers,
        comments: [],
        reviews: requestingChangesReviews,
        commits: simpleCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      cli.clearCalls();
      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn cannot be fast-tracked because of approvals', () => {
      const cli = new TestCLI();

      const expectedLogs = {
        info:
          [['This PR was created on Fri, 30 Nov 2018 17:50:44 GMT'],
            ['This PR is being fast-tracked']],
        error:
         [['Requested Changes: 2'],
           ['- Foo User (@foo): https://github.com/nodejs/node/pull/16438#pullrequestreview-71480624'],
           ['- Bar User (@bar) (TSC): https://github.com/nodejs/node/pull/16438#pullrequestreview-71482624'],
           ['Approvals: 0']]
      };

      const PR = Object.assign({}, firstTimerPR, {
        createdAt: LT_48H,
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      cli.clearCalls();
      const status = checker.checkReviewsAndWait(new Date(NOW));
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkCI', () => {
    it('should error if no CI runs detected', async() => {
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should summarize CI runs detected', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        info: [
          [
            'Last Full PR CI on 2017-10-25T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/node-test-pull-request/10992/'
          ],
          [
            'Last CITGM CI on 2017-10-22T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/citgm-smoker/1030/'
          ],
          [
            'Last libuv CI on 2017-10-23T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/libuv-test-commit/537/'
          ],
          [
            'Last No Intl CI on 2017-10-24T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/node-test-commit-nointl/7/'
          ],
          [
            'Last V8 CI on 2017-10-25T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/node-test-commit-v8-linux/1018/'
          ],
          [
            'Last Benchmark CI on 2017-10-26T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/benchmark-node-micro-benchmarks/20/'
          ],
          [
            'Last Linter CI on 2017-10-27T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/node-test-linter/13127/'
          ],
          [
            'Last Lite Commit CI on 2017-10-28T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/node-test-commit-lite/246/'
          ],
          [
            'Last Lite PR Pipeline CI on 2017-10-29T04:16:36.458Z: ' +
            'https://ci.nodejs.org/job/node-test-pull-request-lite-pipeline/7213/pipeline/'
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = await checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs, {
        ignore: ['startSpinner', 'updateSpinner', 'stopSpinner']
      });
    });

    it('should check commits after last ci', async() => {
      const cli = new TestCLI();
      const { commits, comment } = commitsAfterCi;

      const expectedLogs = {
        warn: [
          ['Commits were pushed after the last Full PR CI run:'],
          ['- fixup: adjust spelling'],
          ['- doc: add api description README'],
          ['- feat: add something']
        ],
        info: [
          ['Last Lite PR Pipeline CI on 2017-10-22T11:19:25Z: https://ci.nodejs.org/job/node-test-pull-request-lite-pipeline/10984'],
          ['Last Full PR CI on 2017-10-24T11:19:25Z: https://ci.nodejs.org/job/node-test-pull-request/10984/']
        ]
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: comment,
        reviews: approvingReviews,
        commits: commits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs, {
        ignore: ['startSpinner', 'updateSpinner', 'stopSpinner']
      });
    });

    it('should only log last three commits if multiple', async() => {
      const cli = new TestCLI();
      const { commits, comment } = mulipleCommitsAfterCi;

      const expectedLogs = {
        warn: [
          ['Commits were pushed after the last Full PR CI run:'],
          ['- doc: add api description README'],
          ['- feat: add something'],
          ['- style: format code'],
          ['...(use `--max-commits 4` to see the full list of commits)']
        ],
        info: [
          [
            'Last Full PR CI on 2017-08-24T11:19:25Z: ' +
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      }, {}, argv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs, {
        ignore: ['startSpinner', 'updateSpinner', 'stopSpinner']
      });
    });

    it('should log as expected if passed 0', async() => {
      const cli = new TestCLI();
      const { commits, comment } = mulipleCommitsAfterCi;

      const expectedLogs = {
        warn: [
          ['Commits were pushed after the last Full PR CI run:'],
          ['...(use `--max-commits 4` to see the full list of commits)']
        ],
        info: [
          [
            'Last Full PR CI on 2017-08-24T11:19:25Z: ' +
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      }, {}, { maxCommits: 0 });

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs, {
        ignore: ['startSpinner', 'updateSpinner', 'stopSpinner']
      });
    });

    it('should count LITE CI as valid ci requirement', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        info: [
          [
            'Last Lite Commit CI on 2018-02-09T21:38:30Z: ' +
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      }, {}, { maxCommits: 0 });

      const status = await checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs, {
        ignore: ['startSpinner', 'updateSpinner', 'stopSpinner']
      });
    });
  });

  describe('checkGitHubCI', () => {
    const baseData = {
      pr: firstTimerPR,
      reviewers: allGreenReviewers,
      comments: commentsWithLGTM,
      reviews: approvingReviews,
      collaborators,
      authorIsNew: () => true,
      getThread() {
        return PRData.prototype.getThread.call(this);
      }
    };
    const testArgv = Object.assign({}, argv, { ciType: 'github-check' });

    it('should error if no CI runs detected', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['No CI runs detected']
        ]
      };

      const commits = githubCI['no-status'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error if both statuses failed', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['Last GitHub CI failed']
        ]
      };

      const commits = githubCI['both-apis-failure'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should succeed if both statuses succeeded', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        info: [
          ['Last GitHub CI successful']
        ]
      };

      const commits = githubCI['both-apis-success'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error if Check suite failed', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['Last GitHub CI failed']
        ]
      };

      const commits = githubCI['check-suite-failure'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error if Check suite pending', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['GitHub CI is still running']
        ]
      };

      const commits = githubCI['check-suite-pending'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should succeed if Check suite succeeded', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        info: [
          ['Last GitHub CI successful']
        ]
      };

      const commits = githubCI['check-suite-success'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error if commit status failed', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['Last GitHub CI failed']
        ]
      };

      const commits = githubCI['commit-status-only-failure'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error if commit status pending', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['GitHub CI is still running']
        ]
      };

      const commits = githubCI['commit-status-only-pending'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should succeed if commit status succeeded', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        info: [
          ['Last GitHub CI successful']
        ]
      };

      const commits = githubCI['commit-status-only-success'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error if Check succeeded but commit status failed ', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['Last GitHub CI failed']
        ]
      };

      const commits = githubCI['status-failure-check-suite-succeed'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error if commit status succeeded but Check failed ', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['Last GitHub CI failed']
        ]
      };

      const commits = githubCI['status-succeed-check-suite-failure'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should error if last commit doesnt have CI', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        error: [
          ['No CI runs detected']
        ]
      };

      const commits = githubCI['two-commits-first-ci'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(!status);
      cli.assertCalledWith(expectedLogs);
    });

    it('should succeed with two commits if last one has CI', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        info: [
          ['Last GitHub CI successful']
        ]
      };

      const commits = githubCI['two-commits-last-ci'];
      const data = Object.assign({}, baseData, { commits });

      const checker = new PRChecker(cli, data, {}, testArgv);

      const status = await checker.checkCI();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkAuthor', () => {
    it('should check odd commits for first timers', async() => {
      const cli = new TestCLI();

      const expectedLogs = {
        warn: [
          ['PR author is a new contributor: @pr_author(pr_author@example.com)'],
          ['- commit e3ad7c72e88c is authored by test@example.com'],
          ['- commit da39a3ee5e6b is authored by test@example.com']
        ]
      };

      const data = {
        pr: firstTimerPR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: oddCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);
      const status = await checker.checkAuthor();
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
      const checker = new PRChecker(cli, data, {}, argv);
      const status = checker.checkAuthor();
      assert(status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkGitConfig', () => {
    it('should log an warning is user has wrong git config', () => {
      const cli = new TestCLI();
      const expectedLogs = {
        warn: [
          [
            'GitHub cannot link the author of \'doc: some changes\' ' +
            'to their GitHub account.'
          ],
          [
            'Please suggest them to take a look at ' +
            'https://github.com/nodejs/node/blob/99b1ada/doc/guides/contributing/pull-requests.md#step-1-fork'
          ]
        ]
      };

      const data = {
        pr: firstTimerPrivatePR,
        reviewers: allGreenReviewers,
        comments: commentsWithLGTM,
        reviews: approvingReviews,
        commits: incorrectGitConfigCommits,
        collaborators,
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };

      const checker = new PRChecker(cli, data, {}, argv);
      const status = checker.checkGitConfig();

      assert.deepStrictEqual(status, true);
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

      const checker = new PRChecker(cli, data, {}, argv);
      const status = checker.checkGitConfig();

      assert(status);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkCommitsAfterReview', () => {
    const cli = new TestCLI();

    afterEach(() => {
      cli.clearCalls();
    });

    it('should warn about commit pushed since the last review', () => {
      const { commits, reviews } = singleCommitAfterReview;

      const expectedLogs = {
        warn: [
          ['Commits were pushed since the last review:'],
          ['- src: fix issue with es-modules']
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };

      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn about multiple commits since the last review', () => {
      const { commits, reviews } = multipleCommitsAfterReview;

      const expectedLogs = {
        warn: [
          ['Commits were pushed since the last review:'],
          ['- src: add requested feature'],
          ['- nit: edit mistakes']
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should only warn last three commits if more than 3 commits', () => {
      const { commits, reviews } = moreThanThreeCommitsAfterReview;
      const expectedLogs = {
        warn: [
          ['Commits were pushed since the last review:'],
          ['- src: add requested feature'],
          ['- nit: edit mistakes'],
          ['- final: we should be good to go'],
          ['...(use `--max-commits 4` to see the full list of commits)']
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkCommitsAfterReview();
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
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkCommitsAfterReview();
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      }, {}, argv);

      const status = checker.checkCommitsAfterReview();
      assert.deepStrictEqual(status, true);
    });

    it('should log as expected if passed 1 as flag', () => {
      const { commits, reviews } = moreThanThreeCommitsAfterReview;
      const expectedLogs = {
        warn: [
          ['Commits were pushed since the last review:'],
          ['- final: we should be good to go'],
          ['...(use `--max-commits 4` to see the full list of commits)']
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };

      const checker = new PRChecker(cli, data, {}, { maxCommits: 1 });
      const status = checker.checkCommitsAfterReview();
      cli.assertCalledWith(expectedLogs);
      assert(!status);
    });

    it('should log as expected if passed 0 as flag', () => {
      const { commits, reviews } = moreThanThreeCommitsAfterReview;
      const expectedLogs = {
        warn: [
          ['Commits were pushed since the last review:'],
          ['...(use `--max-commits 4` to see the full list of commits)']
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
        authorIsNew: () => true,
        getThread() {
          return PRData.prototype.getThread.call(this);
        }
      };

      const checker = new PRChecker(cli, data, {}, { maxCommits: 0 });
      const status = checker.checkCommitsAfterReview();
      cli.assertCalledWith(expectedLogs);
      assert(!status);
    });
  });

  describe('checkMergeableState', () => {
    const cli = new TestCLI();

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
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkMergeableState();
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
      const checker = new PRChecker(cli, data, {}, argv);

      const status = checker.checkMergeableState();
      assert.deepStrictEqual(status, true);
      cli.assertCalledWith(expectedLogs);
    });
  });

  describe('checkPRStatus - check PR status (closed || merged)', () => {
    const cli = new TestCLI();

    afterEach(() => {
      cli.clearCalls();
    });

    it('should warn if PR is closed', () => {
      const expectedLogs = {
        warn: [
          ['This PR was closed on Sat, 28 Oct 2017 11:13:43 GMT']
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

      const checker = new PRChecker(cli, data, {}, argv);
      const status = checker.checkPRState();
      assert.strictEqual(status, false);
      cli.assertCalledWith(expectedLogs);
    });

    it('should warn if PR is merged', () => {
      const expectedLogs = {
        warn: [
          ['This PR was merged on Sat, 28 Oct 2017 11:13:43 GMT']
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

      const checker = new PRChecker(cli, data, {}, argv);
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

      const checker = new PRChecker(cli, data, {}, argv);
      const status = checker.checkPRState();
      assert.strictEqual(status, true);
      cli.assertCalledWith(expectedLogs);
    });
  });
});
