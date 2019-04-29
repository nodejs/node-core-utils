'use strict';

const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;

const WAIT_TIME_MULTI_APPROVAL = 24 * 2;
const WAIT_TIME_SINGLE_APPROVAL = 24 * 7;

const {
  REVIEW_SOURCES: { FROM_COMMENT, FROM_REVIEW_COMMENT }
} = require('./reviews');
const {
  CONFLICTING
} = require('./mergeable_state');

const {
  JobParser,
  CI_TYPES,
  isLiteCI,
  isFullCI
} = require('./ci/ci_type_parser');

const GIT_CONFIG_GUIDE_URL = 'https://github.com/nodejs/node/blob/99b1ada/doc/guides/contributing/pull-requests.md#step-1-fork';

class PRChecker {
  /**
   * @param {{}} cli
   * @param {PRData} data
   */
  constructor(cli, data, argv) {
    this.cli = cli;
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

  checkAll(checkComments = false) {
    const status = [
      this.checkCommitsAfterReview(),
      this.checkCI(),
      this.checkReviewsAndWait(new Date(), checkComments),
      this.checkMergeableState(),
      this.checkPRState(),
      this.checkGitConfig()
    ];

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
      cli.error(`Approvals: 0`);
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

    const createTime = new Date(this.pr.createdAt);
    const msFromCreateTime = now.getTime() - createTime.getTime();
    const minutesFromCreateTime = Math.ceil(msFromCreateTime / MINUTE);
    const hoursFromCreateTime = Math.ceil(msFromCreateTime / HOUR);
    let timeLeftMulti = WAIT_TIME_MULTI_APPROVAL - hoursFromCreateTime;
    const timeLeftSingle = WAIT_TIME_SINGLE_APPROVAL - hoursFromCreateTime;

    if (approved.length >= 2) {
      if (isFastTracked || isCodeAndLearn) {
        return true;
      }
      if (timeLeftMulti < 0) {
        return true;
      }
      if (timeLeftMulti === 0) {
        const timeLeftMins =
          WAIT_TIME_MULTI_APPROVAL * 60 - minutesFromCreateTime;
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
      timeLeftMulti = timeLeftMulti < 0 ? 0 : timeLeftMulti;
      cli.error(`This PR needs to wait ${timeLeftSingle} more hours to land ` +
                `(or ${timeLeftMulti} hours if there is one more approval)`);
      return false;
    }
  }

  hasFullOrLiteCI(ciMap) {
    const cis = [...ciMap.keys()];
    return cis.find(ci => isFullCI(ci) || isLiteCI(ci));
  }

  // TODO: we might want to check CI status when it's less flaky...
  // TODO: not all PR requires CI...labels?
  checkCI() {
    const { cli, commits, argv } = this;
    const { maxCommits } = argv;
    const thread = this.data.getThread();
    const ciMap = new JobParser(thread).parse();
    let status = true;
    if (!ciMap.size) {
      cli.error('No CI runs detected');
      this.CIStatus = false;
      return false;
    } else if (!this.hasFullOrLiteCI(ciMap)) {
      status = false;
      cli.error('No full CI runs or lite CI runs detected');
    }

    let lastCI;
    for (const [type, ci] of ciMap) {
      const name = CI_TYPES.get(type).name;
      cli.info(`Last ${name} CI on ${ci.date}: ${ci.link}`);
      if (!lastCI || lastCI.date < ci.date) {
        lastCI = {
          typeName: name,
          date: ci.date
        };
      }
    }

    if (lastCI) {
      let afterCommits = [];
      commits.forEach((commit) => {
        commit = commit.commit;
        if (commit.committedDate > lastCI.date) {
          status = false;
          afterCommits.push(commit);
        }
      });

      let totalCommits = afterCommits.length;
      if (totalCommits > 0) {
        let warnMsg = `Commits were pushed after the last ` +
          `${lastCI.typeName} CI run:`;

        cli.warn(warnMsg);
        let sliceLength = maxCommits === 0 ? totalCommits : -maxCommits;
        afterCommits.slice(sliceLength)
          .forEach(commit => {
            cli.warn(`- ${commit.messageHeadline}`);
          });

        if (totalCommits > maxCommits) {
          let infoMsg = '...(use `' +
            `--max-commits ${totalCommits}` +
            '` to see the full list of commits)';
          cli.warn(infoMsg);
        }
      }
    }

    this.CIStatus = status;
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
      const hash = oid.slice(0, 7);
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
    for (let { commit } of commits) {
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

    let afterCommits = [];
    commits.forEach((commit) => {
      commit = commit.commit;
      if (commit.committedDate > reviewDate) {
        afterCommits.push(commit);
      }
    });

    let totalCommits = afterCommits.length;
    if (totalCommits > 0) {
      cli.warn(`Commits were pushed since the last review:`);
      let sliceLength = maxCommits === 0 ? totalCommits : -maxCommits;
      afterCommits.slice(sliceLength)
        .forEach(commit => {
          cli.warn(`- ${commit.messageHeadline}`);
        });

      if (totalCommits > maxCommits) {
        let infoMsg = '...(use `' +
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
      pr: { closed, merged },
      cli
    } = this;

    if (merged) {
      cli.warn('This PR is merged');
      return false;
    }

    if (closed) {
      cli.warn('This PR is closed');
      return false;
    }

    return true;
  }
}

module.exports = PRChecker;
