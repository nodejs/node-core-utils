'use strict';

// lib/queries/*.gql file names
const PR_QUERY = 'PRQuery';

class PRQuery {
  /**
   * @param {Object} argv
   * @param {Object} cli
   * @param {Object} request
   */
  constructor(argv, cli, request) {
    const { assignee, owner, repo } = argv;
    this.assignee = assignee;
    this.owner = owner;
    this.repo = repo;
    this.cli = cli;
    this.argv = argv;
    this.request = request;

    // Data
    this.prids = [];
  }

  async getPRs() {
    const { assignee, owner, repo, cli, request } = this;
    const vars = {
      query: `repo:${owner}/${repo} is:pr is:open assignee:${assignee}`
    };
    cli.updateSpinner(`Getting PRs for ${assignee}`);
    this.prids = await request.gql(PR_QUERY, vars);
    return this.prids.search.nodes.map(x => x.number);
  }
};

module.exports = PRQuery;
