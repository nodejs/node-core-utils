import {
  REVIEW_SOURCES
} from './reviews.js';
import {
  CONFLICTING
} from './mergeable_state.js';
import {
  shortSha
} from './utils.js';
import {
  JobParser,
  CI_TYPES,
  CI_PROVIDERS,
  isFullCI
} from './ci/ci_type_parser.js';
import { PRBuild } from './ci/build-types/pr_build.js';

const { FROM_COMMENT, FROM_REVIEW_COMMENT } = REVIEW_SOURCES;

const SECOND = 1000;
const MINUTE = SECOND * 60;

const WAIT_TIME_MULTI_APPROVAL = 24 * 2;
const WAIT_TIME_SINGLE_APPROVAL = 24 * 7;

const GITHUB_SUCCESS_CONCLUSIONS = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];

const FAST_TRACK_RE = /^Fast-track has been requested by @(.+?)\. Please 👍 to approve\.$/;
const FAST_TRACK_MIN_APPROVALS = 2;
const GIT_CONFIG_GUIDE_URL = 'https://github.com/nodejs/node/blob/99b1ada/doc/guides/contributing/pull-requests.md#step-1-fork';

export const PR_CHECK_REASON_CODES = Object.freeze({
  CANCELLED_GITHUB_CI: 'cancelled-github-ci',
  CLOSED: 'closed',
  CONFLICT: 'conflict',
  FAILED_GITHUB_CI: 'failed-github-ci',
  FAILED_JENKINS_CI: 'failed-jenkins-ci',
  INVALID_CI_TYPE: 'invalid-ci-type',
  MERGED: 'merged',
  MISSING_APPROVAL: 'missing-approval',
  MISSING_FAST_TRACK_COMMENT: 'missing-fast-track-comment',
  MISSING_FULL_JENKINS_CI: 'missing-full-jenkins-ci',
  MISSING_GITHUB_CI: 'missing-github-ci',
  MISSING_JENKINS_CI: 'missing-jenkins-ci',
  MISSING_TSC_APPROVAL: 'missing-tsc-approval',
  NEW_CONTRIBUTOR: 'new-contributor',
  NO_COMMITS: 'no-commits',
  PENDING_GITHUB_CI: 'pending-github-ci',
  PENDING_JENKINS_CI: 'pending-jenkins-ci',
  REQUESTED_CHANGES: 'requested-changes',
  STALE_CI: 'stale-ci',
  STALE_REVIEW: 'stale-review',
  WAIT_TIME: 'wait-time'
});

export default class PRChecker {
  /**
   * @param {{}} cli
   * @param {PRData} data
   */
  constructor(cli, data, request, argv) {
    this.cli = cli;
    this.request = request;
    this.data = data;
    const {
      pr, reviewers, comments, reviews, commits
    } = data;
    this.reviewers = reviewers;
    this.pr = pr;
    this.comments = comments;
    // this.reviews and this.commits must
    // be in order as received from github api
    // to check if new commits were pushed after
    // the last review.
    this.reviews = reviews;
    this.commits = commits;
    this.argv = argv;
    this.reasons = [];
  }

  addReason(code, message, details = {}) {
    this.reasons.push({
      code,
      message,
      ...details
    });
  }

  getResult(status) {
    return {
      ready: status,
      reasons: this.reasons
    };
  }

  get waitTimeSingleApproval() {
    if (this.argv.waitTimeSingleApproval === undefined) {
      return WAIT_TIME_SINGLE_APPROVAL;
    }
    return this.argv.waitTimeSingleApproval;
  }

  get waitTimeMultiApproval() {
    if (this.argv.waitTimeMultiApproval === undefined) {
      return WAIT_TIME_MULTI_APPROVAL;
    }
    return this.argv.waitTimeMultiApproval;
  }

  async checkAll(checkComments = false, checkCI = true) {
    this.reasons = [];

    const status = [
      this.checkCommitsAfterReview(),
      this.checkReviewsAndWait(new Date(), checkComments),
      this.checkMergeableState(),
      this.checkPRState(),
      this.checkGitConfig()
    ];

    if (checkCI) {
      status.push(await this.checkCI());
    }

    if (this.data.authorIsNew()) {
      status.push(this.checkAuthor());
    }

    // TODO: check for pre-backport, Github API v4
    // does not support reading files changed

    return status.every((i) => i);
  }

  getTSC(people) {
    return people
      .filter((p) => p.reviewer.isTSC())
      .map((p) => p.reviewer.login);
  }

  formatReview(reviewer, review) {
    let hint = '';
    if (reviewer.isTSC()) {
      hint = ' (TSC)';
    }
    return `- ${reviewer.getName()}${hint}: ${review.ref}`;
  }

  displayReviews(checkComments) {
    const { cli, reviewers: { requestedChanges, approved } } = this;
    if (requestedChanges.length > 0) {
      const message = `Requested Changes: ${requestedChanges.length}`;
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.REQUESTED_CHANGES, message, {
        count: requestedChanges.length
      });
      for (const { reviewer, review } of requestedChanges) {
        cli.error(this.formatReview(reviewer, review));
      }
    }

    if (approved.length === 0) {
      const message = 'Approvals: 0';
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.MISSING_APPROVAL, message);
      return;
    }

    cli.ok(`Approvals: ${approved.length}`);
    for (const { reviewer, review } of approved) {
      cli.ok(this.formatReview(reviewer, review));
      if (checkComments &&
          [FROM_COMMENT, FROM_REVIEW_COMMENT].includes(review.source)) {
        cli.info(`- ${reviewer.getName()} approved in via LGTM in comments`);
      }
    }
  }

  checkReviewsAndWait(now, checkComments, isReleaseProposal) {
    const {
      pr, cli, reviewers
    } = this;
    const { requestedChanges, approved } = reviewers;

    const dateStr = new Date(pr.createdAt).toUTCString();
    cli.info(`This PR was created on ${dateStr}`);
    this.displayReviews(checkComments);

    if (isReleaseProposal) {
      cli.info('This PR is a release proposal');
      return approved.length !== 0;
    }

    const labels = pr.labels.nodes.map((l) => l.name);

    let isFastTracked = labels.includes('fast-track');
    const isCodeAndLearn = labels.includes('code-and-learn');
    const isSemverMajor = labels.includes('semver-major');
    // NOTE: a semver-major PR with fast-track should have either one of
    // these labels removed because that doesn't make sense
    if (isFastTracked) {
      cli.info('This PR is being fast-tracked');
    } else if (isCodeAndLearn) {
      cli.info('This PR is being fast-tracked because ' +
               'it is from a Code and Learn event');
    }

    if (approved.length === 0 || requestedChanges.length > 0) {
      return false;
    }

    if (isSemverMajor) {
      const tscApproved = approved
        .filter((p) => p.reviewer.isTSC())
        .map((p) => p.reviewer.login);
      if (tscApproved.length < 2) {
        const message = 'semver-major requires at least 2 TSC approvals';
        cli.error(message);
        this.addReason(PR_CHECK_REASON_CODES.MISSING_TSC_APPROVAL, message, {
          approvals: tscApproved.length,
          required: 2
        });
        return false; // 7 day rule doesn't matter here
      }
    }

    let fastTrackAppendix = '';
    if (isFastTracked) {
      const comment = [...this.comments].reverse().find((c) =>
        FAST_TRACK_RE.test(c.bodyText));
      if (!comment) {
        const message = 'Unable to find the fast-track request comment.';
        cli.error(message);
        this.addReason(
          PR_CHECK_REASON_CODES.MISSING_FAST_TRACK_COMMENT,
          message
        );
        return false;
      }
      const [, requester] = comment.bodyText.match(FAST_TRACK_RE);
      const collaborators = Array.from(this.data.collaborators.values(),
        (c) => c.login.toLowerCase());
      const approvals = comment.reactions.nodes.filter((r) =>
        r.user.login !== requester &&
        r.user.login !== pr.author.login &&
        collaborators.includes(r.user.login.toLowerCase())).length;

      const missingFastTrackApprovals = FAST_TRACK_MIN_APPROVALS - approvals -
        (requester === pr.author.login ? 0 : 1);
      if (missingFastTrackApprovals > 0) {
        isFastTracked = false;
        fastTrackAppendix = ' (or 0 hours if there ' +
          `${missingFastTrackApprovals === 1 ? 'is' : 'are'} ` +
          `${missingFastTrackApprovals} more approval` +
          `${missingFastTrackApprovals === 1 ? '' : 's'} (👍) of ` +
          'the fast-track request from collaborators).';
      }
    }

    const createTime = new Date(this.pr.createdAt);
    const msFromCreateTime = now.getTime() - createTime.getTime();
    const minutesFromCreateTime = msFromCreateTime / MINUTE;
    const timeLeftMulti = this.waitTimeMultiApproval * 60 - minutesFromCreateTime;
    const timeLeftSingle = this.waitTimeSingleApproval * 60 - minutesFromCreateTime;
    const timeToText = (time, liaison_word = undefined) => {
      let unity = 'minute';
      if (time > 59) {
        unity = 'hour';
        time /= 60;
      }
      time = Math.ceil(time);
      return `${time} ${liaison_word ? liaison_word + ' ' : ''}${unity}${time === 1 ? '' : 's'}`;
    };

    if (approved.length >= 2) {
      if (isFastTracked || isCodeAndLearn) {
        return true;
      }
      if (timeLeftMulti < 0) {
        return true;
      }
      const message =
        `This PR needs to wait ${timeToText(timeLeftMulti, 'more')} to land${fastTrackAppendix}`;
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.WAIT_TIME, message);
      return false;
    }

    if (approved.length === 1) {
      if (timeLeftSingle < 0) {
        return true;
      }
      const message =
        `This PR needs to wait ${timeToText(timeLeftSingle, 'more')} to land (or ${
          timeToText(timeLeftMulti < 0 || isFastTracked ? 0 : timeLeftMulti)
        } if there is one more approval)${fastTrackAppendix}`;
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.WAIT_TIME, message);
      return false;
    }
  }

  hasFullCI(ciMap) {
    const cis = [...ciMap.keys()];
    return cis.find(isFullCI);
  }

  async checkCI() {
    const ciType = this.argv.ciType || CI_PROVIDERS.NODEJS;
    const providers = Object.values(CI_PROVIDERS);

    if (!providers.includes(ciType)) {
      const message =
        `Invalid ciType ${ciType} - must be one of ${providers.join(', ')}`;
      this.cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.INVALID_CI_TYPE, message, {
        ciType
      });
      return false;
    }

    let status = false;
    if (ciType === CI_PROVIDERS.NODEJS) {
      status = await this.checkNodejsCI();
    } else if (ciType === CI_PROVIDERS.GITHUB) {
      status = this.checkGitHubCI();
    }

    return status;
  }

  // TODO: we might want to check CI status when it's less flaky...
  // TODO: not all PR requires CI...labels?
  async checkJenkinsCI() {
    const { cli, commits, request, argv } = this;
    const { maxCommits } = argv;
    const thread = this.data.getThread();
    const ciMap = new JobParser(thread).parse();

    let status = true;
    if (!ciMap.size) {
      const message = 'No Jenkins CI runs detected';
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.MISSING_JENKINS_CI, message, {
        provider: 'jenkins'
      });
      this.CIStatus = false;
      return false;
    } else if (!this.hasFullCI(ciMap)) {
      status = false;
      const message = 'No full Jenkins CI runs detected';
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.MISSING_FULL_JENKINS_CI, message, {
        provider: 'jenkins'
      });
    }

    let lastCI;
    for (const [type, ci] of ciMap) {
      const name = CI_TYPES.get(type).name;
      cli.info(`Last ${name} CI on ${ci.date}: ${ci.link}`);
      if (!lastCI || lastCI.date < ci.date) {
        lastCI = {
          typeName: name,
          date: ci.date,
          jobId: ci.jobid
        };
      }
    }

    if (lastCI) {
      const afterCommits = [];
      commits.forEach((commit) => {
        commit = commit.commit;
        if (commit.committedDate > lastCI.date) {
          status = false;
          afterCommits.push(commit);
        }
      });

      const totalCommits = afterCommits.length;
      if (totalCommits > 0) {
        const warnMsg = 'Commits were pushed after the last ' +
          `${lastCI.typeName} CI run:`;

        cli.warn(warnMsg);
        this.addReason(PR_CHECK_REASON_CODES.STALE_CI, warnMsg, {
          commits: totalCommits,
          provider: 'jenkins'
        });
        const sliceLength = maxCommits === 0 ? totalCommits : -maxCommits;
        afterCommits.slice(sliceLength)
          .forEach(commit => {
            cli.warn(`- ${commit.messageHeadline}`);
          });

        if (totalCommits > maxCommits) {
          const infoMsg = '...(use `' +
            `--max-commits ${totalCommits}` +
            '` to see the full list of commits)';
          cli.warn(infoMsg);
        }
      }

      // Check the last CI run for its results.
      const build = new PRBuild(cli, request, lastCI.jobId);
      const { result, failures } = await build.getResults();

      if (result === 'FAILURE') {
        const message =
          `${failures.length} failure(s) on the last Jenkins CI run`;
        cli.error(message);
        this.addReason(PR_CHECK_REASON_CODES.FAILED_JENKINS_CI, message, {
          failures: failures.length,
          provider: 'jenkins'
        });
        status = false;
      // NOTE(mmarchini): not sure why PEDING returns null
      } else if (result === null) {
        const message = 'Last Jenkins CI still running';
        cli.error(message);
        this.addReason(PR_CHECK_REASON_CODES.PENDING_JENKINS_CI, message, {
          provider: 'jenkins'
        });
        status = false;
      } else {
        cli.ok('Last Jenkins CI successful');
      }
    }

    this.CIStatus = status;
    return status;
  }

  checkGitHubCI() {
    const { cli, commits } = this;

    if (!commits || commits.length === 0) {
      const message = 'No commits detected';
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.NO_COMMITS, message);
      return false;
    }

    // NOTE(mmarchini): we only care about the last commit. Maybe in the future
    // we'll want to check all commits for a successful CI.
    const { commit } = commits[commits.length - 1];

    this.CIStatus = false;
    const checkSuites = commit.checkSuites || { nodes: [] };
    if (!commit.status && checkSuites.nodes.length === 0) {
      const message = 'No GitHub CI runs detected';
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.MISSING_GITHUB_CI, message, {
        provider: 'github'
      });
      return false;
    }

    let hasFailures = false;
    const failedJobs = [];
    const cancelledJobs = [];
    const pendingJobs = [];

    // GitHub new Check API
    for (const { status, conclusion, app, checkRuns } of checkSuites.nodes) {
      if (app.slug !== 'github-actions') {
        // Ignore all non-github check suites, such as Dependabot and Codecov.
        // They are expected to show up on PRs whose head branch is not on a
        // fork and never complete.
        continue;
      }

      if (status !== 'COMPLETED') {
        pendingJobs.push({ app: app.slug, status, conclusion });
        continue;
      }

      if (!GITHUB_SUCCESS_CONCLUSIONS.includes(conclusion)) {
        hasFailures = true;

        // If we have detailed checkRuns, show specific failing jobs
        if (checkRuns && checkRuns.nodes && checkRuns.nodes.length > 0) {
          for (const checkRun of checkRuns.nodes) {
            if (checkRun.status === 'COMPLETED' &&
                !GITHUB_SUCCESS_CONCLUSIONS.includes(checkRun.conclusion)) {
              if (checkRun.conclusion === 'CANCELLED') {
                cancelledJobs.push({
                  name: checkRun.name,
                  conclusion: checkRun.conclusion,
                  url: checkRun.detailsUrl
                });
              } else {
                failedJobs.push({
                  name: checkRun.name,
                  conclusion: checkRun.conclusion,
                  url: checkRun.detailsUrl
                });
              }
            }
          }
        } else {
          // Fallback to check suite level information if no checkRuns
          if (conclusion === 'CANCELLED') {
            cancelledJobs.push({
              name: app.slug,
              conclusion,
              url: null
            });
          } else {
            failedJobs.push({
              name: app.slug,
              conclusion,
              url: null
            });
          }
        }
      }
    }

    // Report pending jobs
    if (pendingJobs.length > 0) {
      const message = 'GitHub CI is still running';
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.PENDING_GITHUB_CI, message, {
        jobs: pendingJobs.length,
        provider: 'github'
      });
      return false;
    }

    // Report failed jobs
    if (failedJobs.length > 0) {
      const message = `${failedJobs.length} GitHub CI job(s) failed:`;
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.FAILED_GITHUB_CI, message, {
        jobs: failedJobs.length,
        provider: 'github'
      });
      for (const job of failedJobs) {
        const urlInfo = job.url ? ` (${job.url})` : '';
        cli.error(`  - ${job.name}: ${job.conclusion}${urlInfo}`);
      }
    }

    // Report cancelled jobs
    if (cancelledJobs.length > 0) {
      const message = `${cancelledJobs.length} GitHub CI job(s) cancelled:`;
      cli.error(message);
      this.addReason(PR_CHECK_REASON_CODES.CANCELLED_GITHUB_CI, message, {
        jobs: cancelledJobs.length,
        provider: 'github'
      });
      for (const job of cancelledJobs) {
        const urlInfo = job.url ? ` (${job.url})` : '';
        cli.error(`  - ${job.name}: ${job.conclusion}${urlInfo}`);
      }
    }

    if (hasFailures) {
      return false;
    }

    // GitHub old commit status API
    if (commit.status) {
      const { state } = commit.status;
      if (state === 'PENDING') {
        const message = 'GitHub CI is still running';
        cli.error(message);
        this.addReason(PR_CHECK_REASON_CODES.PENDING_GITHUB_CI, message, {
          provider: 'github'
        });
        return false;
      }

      if (!['SUCCESS', 'EXPECTED'].includes(state)) {
        const message = `GitHub CI failed with status: ${state}`;
        cli.error(message);
        this.addReason(PR_CHECK_REASON_CODES.FAILED_GITHUB_CI, message, {
          provider: 'github',
          state
        });
        return false;
      }
    }

    cli.ok('Last GitHub CI successful');
    this.CIStatus = true;
    return true;
  }

  requiresJenkinsRun() {
    const { pr } = this;

    // NOTE(mmarchini): if files not present, fallback
    // to old behavior. This should only be the case on old tests
    // TODO(mmarchini): add files to all fixtures on old tests
    if (!pr.files) {
      return false;
    }

    const files = pr.files.nodes;

    // Don't require Jenkins run for doc-only change.
    if (files.every(({ path }) => path.endsWith('.md'))) {
      return false;
    }

    const ciNeededFolderRx = /^(deps|lib|src|test)\//;
    const ciNeededToolFolderRx =
      /^tools\/(code_cache|gyp|icu|inspector|msvs|snapshot|v8_gypfiles)/;
    const ciNeededFileRx = /^tools\/\.+.py$/;
    const ciNeededFileList = [
      'tools/build-addons.js',
      'configure',
      'configure.py',
      'Makefile'
    ];
    const ciNeededExtensionList = ['.gyp', '.gypi', '.bat'];

    return files.some(
      ({ path }) =>
        ciNeededFolderRx.test(path) ||
        ciNeededToolFolderRx.test(path) ||
        ciNeededFileRx.test(path) ||
        ciNeededFileList.includes(path) ||
        ciNeededExtensionList.some((ext) => path.endsWith(ext))
    );
  }

  async checkNodejsCI() {
    let status = this.checkGitHubCI();
    if (
      this.pr.labels.nodes.some((l) => l.name === 'needs-ci') ||
      this.requiresJenkinsRun()
    ) {
      status &= await this.checkJenkinsCI();
    } else {
      this.cli.info('Green GitHub CI is sufficient');
    }
    return status;
  }

  checkAuthor() {
    const { cli, commits, pr } = this;

    const oddCommits = this.filterOddCommits(commits);
    if (!oddCommits.length) {
      return true;
    }

    const prAuthor = `${pr.author.login}(${pr.author.email})`;
    const message = `PR author is a new contributor: @${prAuthor}`;
    cli.warn(message);
    this.addReason(PR_CHECK_REASON_CODES.NEW_CONTRIBUTOR, message);
    for (const c of oddCommits) {
      const { oid, author } = c.commit;
      const hash = shortSha(oid);
      cli.warn(`- commit ${hash} is authored by ${author.email}`);
    }
    return false;
  }

  filterOddCommits(commits) {
    return commits.filter((c) => this.isOddAuthor(c.commit));
  }

  isOddAuthor(commit) {
    const { pr } = this;

    // They have turned on the private email feature, can't really check
    // anything, GitHub should know how to link that, see nodejs/node#15489
    if (!pr.author.email) {
      return false;
    }

    // If they have added the alternative email to their account,
    // commit.authoredByCommitter should be set to true by Github
    if (commit.authoredByCommitter) {
      return false;
    }

    if (commit.author.email === pr.author.email) {
      return false;
    }

    // At this point, the commit:
    // 1. is not authored by the commiter i.e. author email is not in the
    //    committer's Github account
    // 3. is not authored by the people opening the PR
    return true;
  }

  checkGitConfig() {
    const { cli, commits } = this;
    for (const { commit } of commits) {
      if (commit.author.user === null) {
        cli.warn('GitHub cannot link the author of ' +
          `'${commit.messageHeadline}' to their GitHub account.`);
        cli.warn('Please suggest them to take a look at ' +
          `${GIT_CONFIG_GUIDE_URL}`);
      }
    }

    return true;
  }

  getApprovedTipOfHead() {
    const {
      commits, reviews, cli, argv
    } = this;
    const { maxCommits } = argv;

    if (commits.length === 0) {
      const message = 'No commits detected';
      cli.warn(message);
      this.addReason(PR_CHECK_REASON_CODES.NO_COMMITS, message);
      return false;
    }

    const reviewIndex = reviews.findLastIndex(
      review => review.authorCanPushToRepository && review.state === 'APPROVED'
    );

    if (reviewIndex === -1) {
      const message = 'No approving reviews found';
      cli.warn(message);
      this.addReason(PR_CHECK_REASON_CODES.MISSING_APPROVAL, message);
      return false;
    }

    const reviewedCommitIndex = commits
      .findLastIndex(({ commit }) => commit.oid === reviews[reviewIndex].commit.oid);

    if (reviewedCommitIndex !== commits.length - 1) {
      const message = 'Commits were pushed since the last approving review:';
      cli.warn(message);
      this.addReason(PR_CHECK_REASON_CODES.STALE_REVIEW, message, {
        commits: commits.length - reviewedCommitIndex - 1
      });
      commits.slice(Math.max(reviewedCommitIndex + 1, commits.length - maxCommits))
        .forEach(({ commit }) => {
          cli.warn(`- ${commit.messageHeadline}`);
        });

      const totalCommits = commits.length - reviewedCommitIndex - 1;
      if (totalCommits > maxCommits) {
        const infoMsg = '...(use `' +
        `--max-commits ${totalCommits}` +
        '` to see the full list of commits)';
        cli.warn(infoMsg);
      }

      return false;
    }

    return reviews[reviewIndex].commit.oid;
  }

  checkCommitsAfterReview() {
    return !!this.getApprovedTipOfHead();
  }

  checkMergeableState() {
    const {
      pr, cli
    } = this;

    if (pr.mergeable && pr.mergeable === CONFLICTING) {
      const message = 'This PR has conflicts that must be resolved';
      cli.warn(message);
      this.addReason(PR_CHECK_REASON_CODES.CONFLICT, message);
      return false;
    }

    return true;
  }

  checkPRState() {
    const {
      pr: { closed, closedAt, merged, mergedAt },
      cli
    } = this;

    if (merged) {
      const dateStr = new Date(mergedAt).toUTCString();
      const message = `This PR was merged on ${dateStr}`;
      cli.warn(message);
      this.addReason(PR_CHECK_REASON_CODES.MERGED, message);
      return false;
    }

    if (closed) {
      const dateStr = new Date(closedAt).toUTCString();
      const message = `This PR was closed on ${dateStr}`;
      cli.warn(message);
      this.addReason(PR_CHECK_REASON_CODES.CLOSED, message);
      return false;
    }

    return true;
  }
}
