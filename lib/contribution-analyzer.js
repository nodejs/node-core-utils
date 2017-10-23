'use strict';

const SEARCH_ISSUE = 'SearchIssue';
const SEARCH_COMMIT = 'SearchCommit';
const USER = 'User';

const { getCollaborators } = require('./collaborators');
const Cache = require('./cache');
const { ascending } = require('./comp');
const { isTheSamePerson } = require('./user');

class ContributionAnalyzer {
  constructor(request, cli, argv) {
    this.request = request;
    this.cli = cli;
    this.argv = argv;
  }

  async getCommits(user) {
    const { request, argv } = this;
    const { owner, repo, branch } = argv;

    const userData = await request.gql(USER, { login: user });
    const authorId = userData.user.id;
    const results = await request.gql(SEARCH_COMMIT, {
      owner, repo, branch, authorId
    }, [ 'repository', 'ref', 'target', 'history' ]);
    return results
      .sort((a, b) => {
        return a.authoredDate > b.authoredDate ? -1 : 1;
      });
  }

  async getParticipation(user) {
    const { request } = this;
    const results = await request.gql(SEARCH_ISSUE, {
      queryString: `involves:${user} repo:nodejs/node`,
      mustBeAuthor: false
    });
    if (results.search.nodes.length === 0) {
      return [{
        url: 'N/A',
        date: 'N/A',
        isRelavent: false,
        type: 'N/A'
      }];
    }

    const res = results.search.nodes
      .map(issue => this.participationByUser(issue, user))
      // .filter((res) => res.isRelavent)
      .sort((a, b) => {
        return a.date > b.date ? -1 : 1;
      });
    return res;
  }

  participationByUser(issue, user) {
    const result = {
      url: issue.url,
      date: new Date(issue.publishedAt).toISOString(),
      isRelavent: false,
      type: ''
    };

    // Author
    if (isTheSamePerson(issue.author, user)) {
      result.date = issue.publishedAt;
      result.isRelavent = true;
      result.type = /pull/.test(issue.url) ? 'pull' : 'issue';
    }

    if (issue.reviews) {
      issue.reviews.nodes.forEach((review) => {
        if (!isTheSamePerson(review.author, user)) {
          return;
        }

        result.isRelavent = true;
        if (review.publishedAt > result.date) {
          result.date = review.publishedAt;
          result.type = 'review';
        }
      });
    }

    issue.comments.nodes.forEach((comment) => {
      if (!isTheSamePerson(comment.author, user)) {
        return;
      }

      result.isRelavent = true;
      if (comment.publishedAt > result.date) {
        result.date = comment.publishedAt;
        result.type = 'comment';
      }
    });

    return result;
  }

  async getContributionsForId(user) {
    const { argv } = this;
    if (argv.type === 'participation') {
      return this.getParticipation(user);
    } else if (argv.type === 'commit') {
      return this.getCommits(user);
    }
  }

  async getLatestContributionForId(user) {
    const contributions = await this.getContributionsForId(user);
    if (contributions.length) {
      return Object.assign({ user }, contributions[0]);
    }
    return {
      user: user,
      url: 'N/A',
      date: 'N/A',
      isRelavent: false,
      type: 'N/A'
    };
  }

  formatContribution(data) {
    if (this.argv.type === 'participation') {
      const type =
        data.type.padEnd(8).toUpperCase();
      const date = data.date.slice(0, 10);
      return `${date} ${type} @${data.user.padEnd(22)} ${data.url}`;
    } else if (this.argv.type === 'commit') {
      const hash = data.oid.slice(0, 7);
      const date = data.authoredDate.slice(0, 10);
      const message = data.messageHeadline;
      return `${date} ${hash} @${data.user.padEnd(22)} ${message}`;
    }
  }

  getResult(user, data) {
    if (this.argv.type === 'participation') {
      return {
        user,
        date: data.date,
        url: data.url,
        type: data.type
      };
    } else if (this.argv.type === 'commit') {
      return {
        user,
        authoredDate: data.authoredDate,
        messageHeadline: data.messageHeadline,
        oid: data.oid
      };
    }
  }

  getDate(item) {
    if (this.argv.type === 'participation') {
      return item.date;
    } else if (this.argv.type === 'commit') {
      return item.authoredDate;
    }
  }

  async getLatestContributionForIds(ids) {
    const { cli } = this;
    const total = ids.length;
    let counter = 1;
    const latestContrib = {};
    for (const user of ids) {
      cli.startSpinner(`Grabbing data for @${user}, ${counter++}/${total}..`);
      const data = await this.getLatestContributionForId(user);
      latestContrib[user] = data;
      cli.stopSpinner(this.formatContribution(data));
    }

    const sorted = ids.sort((a, b) => {
      const aa = latestContrib[a];
      const bb = latestContrib[b];
      return ascending(this.getDate(aa), this.getDate(bb));
    }).map((user) => {
      const data = latestContrib[user];
      return this.getResult(user, data);
    });
    return sorted;
  }

  formatContributionList(list) {
    let txt = '';
    for (const item of list) {
      txt += this.formatContribution(item) + '\n';
    }
    return txt;
  }

  async getLatestContributionForCollaborators() {
    const { cli, argv, request } = this;
    const collaborators = await getCollaborators(cli, request, argv);
    const ids = [...collaborators.keys()];
    return this.getLatestContributionForIds(ids);
  }

  async getLatestContributionForTSC() {
    const { cli, argv, request } = this;
    const collaborators = await getCollaborators(cli, request, argv);
    const tsc = [...collaborators.values()].filter((user) => user.isTSC());
    const ids = tsc.map(user => user.login);
    return this.getLatestContributionForIds(ids);
  }
}

const contribCache = new Cache();
contribCache.wrap(ContributionAnalyzer, {
  getCommits(user) {
    return { key: `commits-${user}`, ext: '.json' };
  },
  getParticipation(user) {
    return { key: `participation-${user}`, ext: '.json' };
  }
});
contribCache.enable();

module.exports = ContributionAnalyzer;
