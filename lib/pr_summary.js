export default class PRSummary {
  /**
   * @param {Object} prid
   * @param {Object} cli
   * @param {PRData} data
   */
  constructor(argv, cli, data) {
    this.argv = argv;
    this.cli = cli;
    this.data = data;
  }

  display() {
    const {
      commits,
      pr: {
        author,
        baseRefName,
        headRefName,
        labels,
        title
      }
    } = this.data;
    const {
      owner,
      prid
    } = this.argv;
    const cli = this.cli;

    const branch = `${author.login}:${headRefName} -> ${owner}:${baseRefName}`;
    const labelStr = labels.nodes.map(label => label.name).join(', ');
    cli.table('Title', `${title} (#${prid})`);
    const authorHint =
      this.data.authorIsNew() ? ', first-time contributor' : '';

    if (author.name && author.email) {
      cli.table('Author',
        `${author.name} <${author.email}> (@${author.login}${authorHint})`);
    } else {
      // Unable to retrive email/name of the PR Author
      cli.warn('Could not retrieve the email or name ' +
               "of the PR author's from user's GitHub profile!");
    }

    cli.table('Branch', `${branch}`);
    cli.table('Labels', `${labelStr}`);

    cli.table('Commits', `${commits.length}`);
    const committers = new Map();
    for (const commit of commits) {
      const data = commit.commit;
      const committer = data.committer;
      committers.set(committer.email, committer);
      cli.log(` - ${data.messageHeadline}`);
    }

    cli.table('Committers', `${committers.size}`);
    for (const { name, email } of committers.values()) {
      cli.log(` - ${name} <${email}>`);
    }
  };
}
