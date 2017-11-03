'use strict';

const { getCollaborators } = require('../lib/collaborators');
const { ReviewAnalyzer } = require('../lib/reviews');

// queries/*.gql file names
const PR_QUERY = 'PR';
const REVIEWS_QUERY = 'Reviews';
const COMMENTS_QUERY = 'PRComments';
const COMMITS_QUERY = 'PRCommits';
const USER_QUERY = 'User';

class PRData {
  /**
   * @param {number} prid
   * @param {string} owner
   * @param {string} repo
   * @param {Object} logger
   * @param {Object} request
   */
  constructor(prid, owner, repo, logger, request) {
    this.prid = prid;
    this.owner = owner;
    this.repo = repo;
    this.logger = logger;
    this.request = request;

    // Data
    this.collaborators = new Map();
    this.pr = {};
    this.reviews = [];
    this.comments = [];
    this.commits = [];
    this.reviewers = [];
  }

  async getAll() {
    await Promise.all([
      this.getCollaborators(),
      this.getPR(),
      this.getReviews(),
      this.getComments(),
      this.getCommits()
    ]);
    this.analyzeReviewers();
  }

  analyzeReviewers() {
    this.reviewers = new ReviewAnalyzer(this).getReviewers();
  }

  async getCollaborators() {
    const { owner, repo, logger, request } = this;
    logger.trace(`Getting collaborator contacts from README of ${owner}/${repo}`);
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;
    const readme = await request.promise({ url });
    this.collaborators = await getCollaborators(readme, logger, owner, repo);
  }

  async getPR() {
    const { prid, owner, repo, logger, request } = this;
    logger.trace(`Getting PR from ${owner}/${repo}/pull/${prid}`);
    const prData = await request.gql(PR_QUERY, { prid, owner, repo });
    const pr = this.pr = prData.repository.pullRequest;
    // Get the mail
    logger.trace(`Getting User information for ${pr.author.login}`);
    const userData = await request.gql(USER_QUERY, { login: pr.author.login });
    const user = userData.user;
    Object.assign(this.pr.author, user);
  }

  async getReviews() {
    const { prid, owner, repo, logger, request } = this;
    const vars = { prid, owner, repo };
    logger.trace(`Getting reviews from ${owner}/${repo}/pull/${prid}`);
    this.reviews = await request.gql(REVIEWS_QUERY, vars, [
      'repository', 'pullRequest', 'reviews'
    ]);
  }

  async getComments() {
    const { prid, owner, repo, logger, request } = this;
    const vars = { prid, owner, repo };
    logger.trace(`Getting comments from ${owner}/${repo}/pull/${prid}`);
    this.comments = await request.gql(COMMENTS_QUERY, vars, [
      'repository', 'pullRequest', 'comments'
    ]);
  }

  async getCommits() {
    const { prid, owner, repo, logger, request } = this;
    const vars = { prid, owner, repo };
    logger.trace(`Getting commits from ${owner}/${repo}/pull/${prid}`);
    this.commits = await request.gql(COMMITS_QUERY, vars, [
      'repository', 'pullRequest', 'commits'
    ]);
  }

  logIntro() {
    const {
      commits,
      logger,
      owner,
      prid,
      pr: {
        author: { login: author },
        baseRefName,
        headRefName,
        labels,
        title
      }
    } = this;

    logger.info(`${title} #${prid}`);
    logger.info(`${author} wants to merge ${commits.length} ` +
                `commit${commits.length === 1 ? '' : 's'} into ` +
                `${owner}:${baseRefName} from ${author}:${headRefName}`);
    logger.info(`Labels: ${labels.nodes.map(label => label.name).join(' ')}`);
  }
};

module.exports = PRData;
