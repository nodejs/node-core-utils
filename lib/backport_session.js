'use strict';

const Session = require('./session');
const { runSync, runAsync } = require('./run');
const { getPrURL } = require('./links');

const { IGNORE } = require('./run');

class BackportSession extends Session {
  constructor(cli, dir, prid, target) {
    // eslint-disable-next-line no-useless-constructor
    super(cli, dir, prid);
    this.target = target
  }

  async backport() {
    const commits = this.grep();
    const { cli } = this;

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
      ' to start backporting?');
    if (shouldCheckout) {
      await runAsync('git', ['checkout', '-b', newBranch]);
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
    this.cli.log('Tips: run the following commands to complete backporing');
    for (const command of commands) {
      this.cli.log(`$ ${command}`);
    }
  }

  grep() {
    const { cli, owner, repo, prid } = this;
    const url = getPrURL(owner, repo, prid);

    cli.log(`Looking for commits of ${url}...`);
    const re = `--grep=PR-URL: ${url}$`;
    const commits = runSync('git', [
      'log', '--all', re, '--format=%h %s'
    ]).trim();
    if (!commits) {
      return [];
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
