import { getCollaborators } from './collaborators.js';
import { ReviewAnalyzer } from './reviews.js';
import {
  FIRST_TIME_CONTRIBUTOR, FIRST_TIMER
} from './user_status.js';

// lib/queries/*.gql file names
const PR_QUERY = 'PR';
const REVIEWS_QUERY = 'Reviews';
const COMMENTS_QUERY = 'PRComments';
const COMMITS_QUERY = 'PRCommits';

export default class PRData {
  /**
   * @param {Object} argv
   * @param {Object} cli
   * @param {Object} request
   */
  constructor(argv, cli, request) {
    const { prid, owner, repo } = argv;
    this.prid = prid;
    this.owner = owner;
    this.repo = repo;
    this.cli = cli;
    this.argv = argv;
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

  getThread() {
    const { pr, comments, reviews } = this;
    const prNode = {
      publishedAt: pr.createdAt,
      bodyText: pr.bodyText
    };
    return comments.concat([prNode]).concat(reviews);
  }

  async getThreadData() {
    return Promise.all([
      this.getPR(),
      this.getReviews(),
      this.getComments()
    ]);
  }

  async getAll(argv) {
    const { prStr } = this;
    this.cli.startSpinner(`Loading data for ${prStr}`);
    await Promise.all([
      this.getCollaborators(),
      this.getThreadData(),
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
    const { cli, request, argv } = this;
    this.collaborators = await getCollaborators(cli, request, argv);
  }

  async getPR() {
    const { prid, owner, repo, cli, request, prStr } = this;
    cli.updateSpinner(`Getting PR from ${prStr}`);
    const prData = await request.gql(PR_QUERY, { prid, owner, repo });
    this.pr = prData.repository.pullRequest;
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

  authorIsNew() {
    const assoc = this.pr.authorAssociation;
    return assoc === FIRST_TIME_CONTRIBUTOR || assoc === FIRST_TIMER;
  }
};
