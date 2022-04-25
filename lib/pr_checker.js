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
const HOUR = MINUTE * 60;

const WAIT_TIME_MULTI_APPROVAL = 24 * 2;
const WAIT_TIME_SINGLE_APPROVAL = 24 * 7;

const GITHUB_SUCCESS_CONCLUSIONS = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];

const FAST_TRACK_RE = /^Fast-track has been requested by @(.+?)\. Please 👍 to approve\.$/;
const GIT_CONFIG_GUIDE_URL = 'https://github.com/nodejs/node/blob/99b1ada/doc/guides/contributing/pull-requests.md#step-1-fork';

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
      pr, reviewers, comments, reviews, commits, collaborators
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
    this.collaboratorEmails = new Set(
      Array.from(collaborators).map((c) => c[1].email)
    );
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
      cli.error(`Requested Changes: ${requestedChanges.length}`);
      for (const { reviewer, review } of requestedChanges) {
        cli.error(this.formatReview(reviewer, review));
      }
    }

    if (approved.length === 0) {
      cli.error('Approvals: 0');
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

  checkReviewsAndWait(now, checkComments) {
    const {
      pr, cli, reviewers
    } = this;
    const { requestedChanges, approved } = reviewers;
    const labels = pr.labels.nodes.map((l) => l.name);

    const isFastTracked = labels.includes('fast-track');
    const isCodeAndLearn = labels.includes('code-and-learn');
    const isSemverMajor = labels.includes('semver-major');

    const dateStr = new Date(pr.createdAt).toUTCString();
    cli.info(`This PR was created on ${dateStr}`);
    this.displayReviews(checkComments);
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
        cli.error('semver-major requires at least 2 TSC approvals');
        return false; // 7 day rule doesn't matter here
      }
    }

    if (isFastTracked) {
      const comment = [...this.comments].reverse().find((c) =>
        FAST_TRACK_RE.test(c.bodyText));
      if (!comment) {
        cli.error('Unable to find the fast-track request comment.');
        return false;
      }
      const [, requester] = comment.bodyText.match(FAST_TRACK_RE);
      const collaborators = Array.from(this.data.collaborators.values(),
        (c) => c.login);
      const approvals = comment.reactions.nodes.filter((r) =>
        r.user.login !== requester &&
        r.user.login !== pr.author.login &&
        collaborators.includes(r.user.login)).length;

      if (requester === pr.author.login && approvals < 2) {
        cli.error('The fast-track request requires' +
                  " at least two collaborators' approvals (👍).");
        return false;
      } else if (approvals === 0) {
        cli.error('The fast-track request requires' +
                  " at least one collaborator's approval (👍).");
        return false;
      }
    }

    const createTime = new Date(this.pr.createdAt);
    const msFromCreateTime = now.getTime() - createTime.getTime();
    const minutesFromCreateTime = Math.ceil(msFromCreateTime / MINUTE);
    const hoursFromCreateTime = Math.ceil(msFromCreateTime / HOUR);
    let timeLeftMulti = this.waitTimeMultiApproval - hoursFromCreateTime;
    const timeLeftSingle = this.waitTimeSingleApproval - hoursFromCreateTime;

    if (approved.length >= 2) {
      if (isFastTracked || isCodeAndLearn) {
        return true;
      }
      if (timeLeftMulti < 0) {
        return true;
      }
      if (timeLeftMulti === 0) {
        const timeLeftMins =
          this.waitTimeMultiApproval * 60 - minutesFromCreateTime;
        cli.error(`This PR needs to wait ${timeLeftMins} more minutes to land`);
        return false;
      }
      cli.error(`This PR needs to wait ${timeLeftMulti} more hours to land`);
      return false;
    }

    if (approved.length === 1) {
      if (timeLeftSingle < 0) {
        return true;
      }
      timeLeftMulti = timeLeftMulti < 0 || isFastTracked ? 0 : timeLeftMulti;
      cli.error(`This PR needs to wait ${timeLeftSingle} more hours to land ` +
                `(or ${timeLeftMulti} hours if there is one more approval)`);
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
      this.cli.error(
        `Invalid ciType ${ciType} - must be one of ${providers.join(', ')}`);
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
      cli.error('No Jenkins CI runs detected');
      this.CIStatus = false;
      return false;
    } else if (!this.hasFullCI(ciMap)) {
      status = false;
      cli.error('No full Jenkins CI runs detected');
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
        cli.error(
          `${failures.length} failure(s) on the last Jenkins CI run`);
        status = false;
      // NOTE(mmarchini): not sure why PEDING returns null
      } else if (result === null) {
        cli.error(
          'Last Jenkins CI still running');
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
      cli.error('No commits detected');
      return false;
    }

    // NOTE(mmarchini): we only care about the last commit. Maybe in the future
    // we'll want to check all commits for a successful CI.
    const { commit } = commits[commits.length - 1];

    this.CIStatus = false;
    const checkSuites = commit.checkSuites || { nodes: [] };
    if (!commit.status && checkSuites.nodes.length === 0) {
      cli.error('No GitHub CI runs detected');
      return false;
    }

    // GitHub new Check API
    for (const { status, conclusion, app } of checkSuites.nodes) {
      if (app && app.slug === 'dependabot') {
        // Ignore Dependabot check suites. They are expected to show up
        // sometimes and never complete.
        continue;
      }

      if (status !== 'COMPLETED') {
        cli.error('GitHub CI is still running');
        return false;
      }

      if (!GITHUB_SUCCESS_CONCLUSIONS.includes(conclusion)) {
        cli.error('Last GitHub CI failed');
        return false;
      }
    }

    // GitHub old commit status API
    if (commit.status) {
      const { state } = commit.status;
      if (state === 'PENDING') {
        cli.error('GitHub CI is still running');
        return false;
      }

      if (!['SUCCESS', 'EXPECTED'].includes(state)) {
        cli.error('Last GitHub CI failed');
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

    return pr.files.nodes.some(
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
    cli.warn(`PR author is a new contributor: @${prAuthor}`);
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

  checkCommitsAfterReview() {
    const {
      commits, reviews, cli, argv
    } = this;
    const { maxCommits } = argv;

    if (reviews.length < 1) {
      return false;
    }

    const reviewIndex = reviews.length - 1;
    const reviewDate = reviews[reviewIndex].publishedAt;

    const afterCommits = [];
    commits.forEach((commit) => {
      commit = commit.commit;
      if (commit.committedDate > reviewDate) {
        afterCommits.push(commit);
      }
    });

    const totalCommits = afterCommits.length;
    if (totalCommits > 0) {
      cli.warn('Commits were pushed since the last review:');
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

      return false;
    }

    return true;
  }

  checkMergeableState() {
    const {
      pr, cli
    } = this;

    if (pr.mergeable && pr.mergeable === CONFLICTING) {
      cli.warn('This PR has conflicts that must be resolved');
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
      cli.warn(`This PR was merged on ${dateStr}`);
      return false;
    }

    if (closed) {
      const dateStr = new Date(closedAt).toUTCString();
      cli.warn(`This PR was closed on ${dateStr}`);
      return false;
    }

    return true;
  }
}
