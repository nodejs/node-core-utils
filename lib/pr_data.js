'use strict';

const fs = require('fs');
const path = require('path');

function loadQuery(file) {
  const filePath = path.resolve(__dirname, '..', 'queries', `${file}.gql`);
  return fs.readFileSync(filePath, 'utf8');
}

const PR_QUERY = loadQuery('PR');
const REVIEWS_QUERY = loadQuery('Reviews');
const COMMENTS_QUERY = loadQuery('PRComments');
const COMMITS_QUERY = loadQuery('PRCommits');
const USER_QUERY = loadQuery('User');

// TODO(joyeecheung): make it mockable with req.rp ?
const { getCollaborators } = require('../lib/collaborators');
const { ReviewAnalyzer } = require('../lib/reviews');

class PRData {
  /**
   * @param {number} prid
   * @param {string} owner
   * @param {string} repo
   * @param {Object} logger
   * @param {Object} req
   */
  constructor(prid, owner, repo, logger, req) {
    this.prid = prid;
    this.owner = owner;
    this.repo = repo;
    this.logger = logger;
    this.request = req.request;
    this.requestAll = req.requestAll;
    this.requestPromise = req.requestPromise;

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
  }

  analyzeReviewers() {
    this.reviewers = new ReviewAnalyzer(this).getReviewers();
  }

  async getCollaborators() {
    const { owner, repo, logger, requestPromise } = this;
    logger.trace(`Getting collaborator contacts from README of ${owner}/${repo}`);
    this.collaborators = await getCollaborators(requestPromise, logger, owner, repo);
  }

  async getPR() {
    const { prid, owner, repo, logger, request } = this;
    logger.trace(`Getting PR from ${owner}/${repo}/pull/${prid}`);
    const prData = await request(PR_QUERY, { prid, owner, repo });
    const pr = this.pr = prData.repository.pullRequest;
    // Get the mail
    logger.trace(`Getting User information for ${pr.author.login}`);
    const userData = await request(USER_QUERY, { login: pr.author.login });
    const user = userData.user;
    Object.assign(this.pr.author, user);
  }

  async getReviews() {
    const { prid, owner, repo, logger, requestAll } = this;
    const vars = { prid, owner, repo };
    logger.trace(`Getting reviews from ${owner}/${repo}/pull/${prid}`);
    this.reviews = await requestAll(REVIEWS_QUERY, vars, [
      'repository', 'pullRequest', 'reviews'
    ]);
  }

  async getComments() {
    const { prid, owner, repo, logger, requestAll } = this;
    const vars = { prid, owner, repo };
    logger.trace(`Getting comments from ${owner}/${repo}/pull/${prid}`);
    this.comments = await requestAll(COMMENTS_QUERY, vars, [
      'repository', 'pullRequest', 'comments'
    ]);
  }

  async getCommits() {
    const { prid, owner, repo, logger, requestAll } = this;
    const vars = { prid, owner, repo };
    logger.trace(`Getting commits from ${owner}/${repo}/pull/${prid}`);
    this.commits = await requestAll(COMMITS_QUERY, vars, [
      'repository', 'pullRequest', 'commits'
    ]);
  }
};

module.exports = PRData;
