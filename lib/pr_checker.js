'use strict';

const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;

const SUNDAY = 0;
const SATURDAY = 6;

const WEEKDAY_WAIT = 48;
const WEEKEND_WAIT = 72;

const {
  REVIEW_SOURCES: { FROM_COMMENT, FROM_REVIEW_COMMENT }
} = require('./reviews');
const {
  CONFLICTING
} = require('./mergeable_state');

const CIParser = require('./ci');
const CI_TYPES = CIParser.TYPES;
const { FULL } = CIParser.constants;

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

  checkAll(comments = false) {
    const status = [
      this.checkReviews(comments),
      this.checkCommitsAfterReview(),
      this.checkCI(),
      this.checkPRWait(new Date()),
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

  getTSCHint(people) {
    const tsc = people
      .filter((p) => p.reviewer.isTSC())
      .map((p) => p.reviewer.login);
    let hint = '';
    if (tsc.length > 0) {
      const list = `(${tsc.join(', ')})`;
      hint = `, ${tsc.length} from TSC ${list}`;
    }
    return hint;
  }

  checkReviews(comments = false) {
    const {
      pr, cli, reviewers: { requestedChanges, approved }
    } = this;
    let status = true;

    if (requestedChanges.length === 0) {
      cli.ok(`Requested Changes: 0`);
    } else {
      status = false;
      let hint = this.getTSCHint(requestedChanges);
      cli.error(`Requested Changes: ${requestedChanges.length}${hint}`);
      for (const { reviewer, review } of requestedChanges) {
        cli.error(`- ${reviewer.getName()}: ${review.ref}`);
      }
    }
    if (approved.length === 0) {
      status = false;
      cli.error(`Approvals: 0`);
    } else {
      let hint = this.getTSCHint(approved);
      cli.ok(`Approvals: ${approved.length}${hint}`);

      if (comments) {
        for (const {reviewer, review} of approved) {
          if (review.source === FROM_COMMENT ||
            review.source === FROM_REVIEW_COMMENT) {
            cli.info(
              `- ${reviewer.getName()} approved in via LGTM in comments`);
          }
        }
      }

      const labels = pr.labels.nodes.map((l) => l.name);
      if (labels.includes('semver-major')) {
        const tscApproval = approved.filter((p) => p.reviewer.isTSC()).length;
        if (tscApproval < 2) {
          status = false;
          cli.error('semver-major requires at least two TSC approvals');
        }
      }
    }

    return status;
  }

  /**
   * @param {Date} now
   */
  getWait(now) {
    const createTime = new Date(this.pr.createdAt);
    const utcDay = createTime.getUTCDay();
    // TODO: do we need to lose this a bit considering timezones?
    const isWeekend = (utcDay === SUNDAY || utcDay === SATURDAY);
    const waitTime = isWeekend ? WEEKEND_WAIT : WEEKDAY_WAIT;
    const timeLeft = waitTime - Math.ceil(
      (now.getTime() - createTime.getTime()) / HOUR
    );

    return {
      isWeekend,
      timeLeft
    };
  }

  // TODO: skip some PRs...we might need a label for that
  /**
   * @param {Date} now
   */
  checkPRWait(now) {
    const {
      pr, cli, reviewers, CIStatus
    } = this;
    const labels = pr.labels.nodes;

    const fast =
      labels.some((l) => ['fast-track'].includes(l.name));
    if (fast) {
      const { approved } = reviewers;
      if (approved.length > 1 && CIStatus) {
        cli.info('This PR is being fast-tracked');
        return true;
      } else {
        const msg = ['This PR is being fast-tracked, but awating '];
        if (approved.length < 2) msg.push('approvals of 2 contributors');
        if (!CIStatus) msg.push('a CI run');

        let warnMsg = msg.length === 2
          ? msg.join('') : `${msg[0] + msg[1]} and ${msg[2]}`;
        cli.warn(warnMsg);
      }

      return false;
    }

    const wait = this.getWait(now);
    if (wait.timeLeft > 0) {
      const dateStr = new Date(pr.createdAt).toDateString();
      const type = wait.isWeekend ? 'weekend' : 'weekday';
      cli.info(`This PR was created on ${dateStr} (${type} in UTC)`);
      cli.warn(`${wait.timeLeft} hours left to land`);
      return false;
    }

    return true;
  }

  // TODO: we might want to check CI status when it's less flaky...
  // TODO: not all PR requires CI...labels?
  checkCI() {
    const { pr, cli, comments, reviews, commits, argv } = this;
    const prNode = {
      publishedAt: pr.createdAt,
      bodyText: pr.bodyText
    };
    const { maxCommits } = argv;
    const thread = comments.concat([prNode]).concat(reviews);
    const ciMap = new CIParser(thread).parse();
    let status = true;
    if (!ciMap.size) {
      cli.error('No CI runs detected');
      this.CIStatus = false;
      return false;
    } else if (!ciMap.get(FULL)) {
      status = false;
      cli.error('No full CI runs detected');
    }

    let lastCI;
    for (const [type, ci] of ciMap) {
      const name = CI_TYPES.get(type).name;
      cli.info(`Last ${name} CI on ${ci.date}: ${ci.link}`);
      if (!lastCI || lastCI.date > ci.date) {
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
        const msg = 'Author does not have correct git config!';
        cli.error(msg);
        return false;
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
