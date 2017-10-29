'use strict';

const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;

const SUNDAY = 0;
const SATURDAY = 6;

const WEEKDAY_WAIT = 48;
const WEEKEND_WAIT = 72;

const logger = require('./logger');
const {
  REVIEW_SOURCES: { FROM_COMMENT }
} = require('./reviews');
const {
  FIRST_TIME_CONTRIBUTOR, FIRST_TIMER
} = require('./user_status');

const CIParser = require('./ci');
const CI_TYPES = CIParser.TYPES;
const { FULL } = CIParser.constants;

/**
 * TODO: do not use logger here, put the summaries in arrays
 */
class PRChecker {
  constructor(pr, reviewers, comments, reviews, commits, collaborators) {
    this.reviewers = reviewers;
    this.pr = pr;
    this.comments = comments;
    this.reviews = reviews;
    this.commits = commits;
    this.collaboratorEmails = new Set(
      Array.from(collaborators).map((c) => c[1].email)
    );
  }

  checkReviews() {
    const { rejected, approved } = this.reviewers;
    if (rejected.length > 0) {
      for (const { reviewer, review } of rejected) {
        logger.warn(`${reviewer.getName()}) rejected in ${review.ref}`);
      }
    }
    if (approved.length === 0) {
      logger.warn('This PR has not been approved yet');
    } else {
      for (const { reviewer, review } of approved) {
        if (review.source === FROM_COMMENT) {
          logger.info(`${reviewer.getName()}) approved in via LGTM in comments`);
        }
      }
    }
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

  checkReviewers() {
    const { rejected, approved } = this.reviewers;
    const pr = this.pr;

    if (rejected.length === 0) {
      logger.info(`Rejections: 0`);
    } else {
      let hint = this.getTSCHint(rejected);
      logger.warn(`Rejections: ${rejected.length}${hint}`);
    }
    if (approved.length === 0) {
      logger.warn(`Approvals: 0`);
    } else {
      let hint = this.getTSCHint(approved);
      logger.info(`Approvals: ${approved.length}${hint}`);
      const labels = pr.labels.nodes.map((l) => l.name);
      if (labels.includes('semver-major')) {
        const tscApproval = approved.filter((p) => p.reviewer.isTSC()).length;
        if (tscApproval < 2) {
          logger.warn('semver-major requires at least two TSC approvals');
        }
      }
    }
  }

  getWait() {
    const createTime = new Date(this.pr.createdAt);
    const now = new Date();
    const utcDay = now.getUTCDay();
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
  checkPRWait() {
    const wait = this.getWait(this.pr);
    if (wait.timeLeft > 0) {
      const dateStr = new Date(this.pr.createdAt).toDateString();
      const type = wait.isWeekend ? 'weekend' : 'weekday';
      logger.info(`This PR was created on ${dateStr} (${type} in UTC)`);
      logger.warn(`${wait.timeLeft} hours left to land`);
    }
  }

  // TODO: we might want to check CI status when it's less flaky...
  // TODO: not all PR requires CI...labels?
  checkCI() {
    const comments = this.comments;
    const reviews = this.reviews;
    const prNode = {
      publishedAt: this.pr.createdAt,
      bodyText: this.pr.bodyText
    };
    const thread = comments.concat([prNode]).concat(reviews);
    const ciMap = new CIParser(thread).parse();
    if (!ciMap.size) {
      logger.warn('No CI runs detected');
    } else if (!ciMap.get(FULL)) {
      logger.warn('No full CI runs detected');
    }

    for (const [type, ci] of ciMap) {
      const name = CI_TYPES.get(type).name;
      logger.info(`Last ${name} CI on ${ci.date}: ${ci.link}`);
    }
  }

  authorIsNew() {
    const assoc = this.pr.authorAssociation;
    return assoc === FIRST_TIME_CONTRIBUTOR || assoc === FIRST_TIMER;
  }

  checkAuthor() {
    const oddCommits = this.filterOddCommits(this.commits);
    if (!oddCommits.length) {
      return;
    }

    const prAuthor = this.pr.author.login;
    logger.warn(`PR is opened by @${prAuthor}`);
    for (const c of oddCommits) {
      const { oid, author } = c.commit;
      const hash = oid.slice(0, 7);
      logger.warn(`Author ${author.email} of commit ${hash} ` +
                  `does not match committer or PR author`);
    }
  }

  filterOddCommits(commits) {
    return commits.filter((c) => this.isOddAuthor(c.commit));
  }

  isOddAuthor(commit) {
    // If they have added the alternative email to their account,
    // commit.authoredByCommitter should be set to true by Github
    if (commit.authoredByCommitter) {
      return false;
    }

    // The commit author is one of the collaborators, they should know
    // what they are doing anyway
    if (this.collaboratorEmails.has(commit.author.email)) {
      return false;
    }

    if (commit.author.email === this.pr.author.email) {
      return false;
    }

    // At this point, the commit:
    // 1. is not authored by the commiter i.e. author email is not in the
    //    committer's Github account
    // 2. is not authored by a collaborator
    // 3. is not authored by the people opening the PR
    return true;
  }
}

module.exports = PRChecker;
