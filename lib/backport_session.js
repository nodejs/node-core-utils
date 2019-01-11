'use strict';

const Session = require('./session');
const { runSync, runAsync } = require('./run');
const { getPrURL, parsePrURL } = require('./links');

const { IGNORE } = require('./run');

const MAX_HISTORY = 10;

class BackportSession extends Session {
  constructor(cli, dir, prid, target) {
    // eslint-disable-next-line no-useless-constructor
    super(cli, dir, prid);
    this.target = target;
  }

  getChangedFiles(rev) {
    return runSync('git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', rev]
    ).trim().split('\n');
  }

  getPreviousCommits(rev, file, num) {
    return runSync('git',
      ['log', `-${num}`, '--format=%h', rev, file]
    ).trim().split('\n');
  }

  getCommitMessage(rev) {
    return runSync('git',
      ['show', '--format=%B', rev]
    ).trim();
  }

  get stagingBranch() {
    return `v${this.target}.x-staging`;
  }

  getPotentialConflicts(rev, targetBranch) {
    const files = this.getChangedFiles(rev);
    const notBackported = new Map();
    for (const file of files) {
      const ancestors = this.getPreviousCommits(`${rev}~1`, file, MAX_HISTORY);
      this.cli.log(`Analyzing ancestors of ${file}`);
      for (const ancestor of ancestors) {
        const message = this.getCommitMessage(ancestor);
        const data = parsePrURL(message);
        const backported = this.getCommitsFromBranch(
          data.prid, targetBranch
        );
        if (backported.length === 0) {
          const record = notBackported.get(ancestor);
          if (record) {
            record.files.add(file);
          } else {
            notBackported.set(ancestor, {
              prid: data.prid,
              url: data.url,
              commit: ancestor,
              title: message.split('\n')[0],
              files: new Set([file]),
            });
          }
        }
      }
    }
    return notBackported;
  }

  warnForPotentialConflicts(rev) {
    const { cli } = this;
    const staging = this.stagingBranch;
    const notBackported = this.getPotentialConflicts(rev, staging);

    if (notBackported.size === 0) {
      return;
    }

    cli.warn(`The following ancestor commits of ${rev} is not on ${staging}`);
    for (const [commit, data] of notBackported) {
      cli.log(`    - ${commit} ${data.title}, ${data.url}`);
      for (const file of data.files) {
        cli.log(`         ${file}`);
      }
    }
  }

  async backport() {
    const { cli } = this;

    const { owner, repo, prid } = this;
    const url = getPrURL(owner, repo, prid);
    cli.log(`Looking for commits of ${url} on master...`);

    const commits = this.getCommitsFromBranch(prid, 'master');

    if (commits.length === 0) {
      cli.error('Could not find any commit matching the PR');
      throw new Error(IGNORE);
    }

    cli.ok('Found the following commits:');
    for (const commit of commits) {
      cli.log(`    - ${commit.sha} ${commit.title}`);
    }

    const newBranch = `backport-${this.prid}-to-${this.target}`;
    const shouldCheckout = await cli.prompt(
      `Do you want to checkout to a new branch \`${newBranch}\`` +
      ' to start backporting?', false);
    if (shouldCheckout) {
      await runAsync('git', ['checkout', '-b', newBranch]);
    }

    for (const commit of commits) {
      cli.log(`Looking for potential conflicts...`);
      this.warnForPotentialConflicts(commit.sha);
    }

    const cherries = commits.map(i => i.sha).reverse();
    const pendingCommands = [
      `git cherry-pick ${cherries.join(' ')}`,
      `git push -u <your-fork-remote> ${newBranch}`
    ];
    const shouldPick = await cli.prompt(
      'Do you want to cherry-pick the commits?');
    if (!shouldPick) {
      this.hintCommands(pendingCommands);
      return;
    }

    cli.log(`Running \`${pendingCommands[0]}\`...`);
    pendingCommands.shift();
    await runAsync('git', ['cherry-pick', ...cherries]);
    this.hintCommands(pendingCommands);
  }

  hintCommands(commands) {
    this.cli.log('Tips: run the following commands to complete backport');
    for (const command of commands) {
      this.cli.log(`$ ${command}`);
    }
  }

  getCommitsFromBranch(prid, branch, loose = true) {
    const { owner, repo } = this;
    let re;
    const url = getPrURL(owner, repo, prid);
    re = `--grep=PR-URL: ${url}$`;

    let commits = runSync('git', [
      'log', re, '--format=%h %s', branch
    ]).trim();
    if (!commits) {
      if (!loose) {
        return [];
      }
      re = `--grep=PR-URL: #${prid}\\b`;
      commits = runSync('git', [
        'log', re, '--format=%h %s', branch
      ]).trim();
      if (!commits) {
        return [];
      }
    }
    
    return commits.split('\n').map((i) => {
      const match = i.match(/(\w+) (.+)/);
      return {
        sha: match[1],
        title: match[2]
      }
    });
  }
}

module.exports = BackportSession;
