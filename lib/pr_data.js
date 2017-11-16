'use strict';

const { getCollaborators } = require('./collaborators');
const { ReviewAnalyzer } = require('./reviews');

// lib/queries/*.gql file names
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
   * @param {Object} cli
   * @param {Object} request
   */
  constructor(prid, owner, repo, cli, request) {
    this.prid = prid;
    this.owner = owner;
    this.repo = repo;
    this.cli = cli;
    this.request = request;
    this.prStr = `${owner}/${repo}/pull/${prid}`;

    // Data
    this.collaborators = new Map();
    this.pr = {};
    this.reviews = [];
    this.comments = [];
    this.commits = [];
    this.reviewers = [];
  }

  async getAll() {
    const { prStr } = this;
    this.cli.startSpinner(`Loading data for ${prStr}`);
    await Promise.all([
      this.getCollaborators(),
      this.getPR(),
      this.getReviews(),
      this.getComments(),
      this.getCommits()
    ]).then(() => {
      this.cli.stopSpinner(`Done loading data for ${prStr}`);
    });
    this.analyzeReviewers();
  }

  analyzeReviewers() {
    this.reviewers = new ReviewAnalyzer(this).getReviewers();
  }

  async getCollaborators() {
    const { owner, repo, cli, request } = this;
    cli.updateSpinner(
      `Getting collaborator contacts from README of ${owner}/${repo}`);
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;
    const readme = await request.promise({ url });
    this.collaborators = await getCollaborators(readme, cli, owner, repo);
  }

  async getPR() {
    const { prid, owner, repo, cli, request, prStr } = this;
    cli.updateSpinner(`Getting PR from ${prStr}`);
    const prData = await request.gql(PR_QUERY, { prid, owner, repo });
    const pr = this.pr = prData.repository.pullRequest;
    // Get the mail
    cli.updateSpinner(`Getting User information for ${pr.author.login}`);
    const userData = await request.gql(USER_QUERY, { login: pr.author.login });
    const user = userData.user;
    Object.assign(this.pr.author, user);
  }

  async getReviews() {
    const { prid, owner, repo, cli, request, prStr } = this;
    const vars = { prid, owner, repo };
    cli.updateSpinner(`Getting reviews from ${prStr}`);
    this.reviews = await request.gql(REVIEWS_QUERY, vars, [
      'repository', 'pullRequest', 'reviews'
    ]);
  }

  async getComments() {
    const { prid, owner, repo, cli, request, prStr } = this;
    const vars = { prid, owner, repo };
    cli.updateSpinner(`Getting comments from ${prStr}`);
    this.comments = await request.gql(COMMENTS_QUERY, vars, [
      'repository', 'pullRequest', 'comments'
    ]);
  }

  async getCommits() {
    const { prid, owner, repo, cli, request, prStr } = this;
    const vars = { prid, owner, repo };
    cli.updateSpinner(`Getting commits from ${prStr}`);
    this.commits = await request.gql(COMMITS_QUERY, vars, [
      'repository', 'pullRequest', 'commits'
    ]);
  }

  logIntro() {
    const {
      commits,
      cli,
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

    const branch = `${author}:${headRefName} -> ${owner}:${baseRefName}`;
    const labelStr = labels.nodes.map(label => label.name).join(', ');
    cli.table('Title', `${title} #${prid}`);
    cli.table('Author', `${author}`);
    cli.table('Commits', `${commits.length}`);
    cli.table('Branch', `${branch}`);
    cli.table('Labels', `${labelStr}`);
  }
};

module.exports = PRData;
