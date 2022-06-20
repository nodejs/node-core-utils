import Session from './session.js';
import { runSync, runAsync, IGNORE } from './run.js';
import { getPrURL, parsePrURL } from './links.js';

const MAX_HISTORY = 10;
const OLDEST_ID = new Map([
  [8, 13000],
  [10, 20000],
  [11, 23000]
]);

export default class BackportSession extends Session {
  constructor(cli, dir, prid, target) {
    super(cli, dir, prid);
    this.target = target;
  }

  getChangedFiles(rev) {
    return runSync('git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', rev]
    ).trim().split('\n');
  }

  getPreviousCommits(rev, file, num) {
    let logs;
    try {
      logs = runSync('git',
        ['log', `-${num}`, '--format=%h', rev, '--', file]
      ).trim();
    } catch (e) {
      return null;
    }
    if (!logs) {
      return [];
    }

    return logs.trim().split('\n');
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
    const { cli } = this;
    const files = this.getChangedFiles(rev);
    const notBackported = new Map();
    const oldest = OLDEST_ID.get(this.target);
    for (const file of files) {
      cli.startSpinner(`Analyzing ancestors of ${file}`);
      // TODO(joyeecheung): if the file does not exit in the current revision,
      // warn about it and skip it.
      const ancestors = this.getPreviousCommits(`${rev}~1`, file, MAX_HISTORY);
      if (!ancestors) {
        cli.stopSpinner(`${file} does not exist in current working tree`,
          cli.SPINNER_STATUS.WARN);
        continue;
      };
      if (ancestors.length === 0) {
        cli.stopSpinner(`Cannot find ancestor commits of ${file}`,
          cli.SPINNER_STATUS.INFO);
        continue;
      }
      for (const ancestor of ancestors) {
        const message = this.getCommitMessage(ancestor);
        cli.updateSpinner(`Analyzing ${message.split('\n')[0]}...`);
        let data = parsePrURL(message);
        if (!data) {
          const match = message.match('/^PR-URL: #(\\d+)/');
          if (!match) {
            cli.stopSpinner(
              `Commit message of ${ancestor} is ill-formed, skipping`,
              cli.SPINNER_STATUS.WARN);
            cli.startSpinner(`Analyzing ancestors of ${file}`);
            continue;
          }
          data = {
            repo: this.repo,
            owner: this.owner,
            prid: parseInt(match[1])
          };
        }
        if (data.prid < oldest) {
          cli.updateSpinner(
            `Commit ${ancestor} iS too old, skipping`,
            cli.SPINNER_STATUS.WARN);
          break;
        }
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
              url: getPrURL(data),
              commit: ancestor,
              title: message.split('\n')[0],
              files: new Set([file])
            });
          }
        }
      }
      cli.stopSpinner(`Analyzed ${file}`);
    }
    return notBackported;
  }

  warnForPotentialConflicts(rev) {
    const { cli } = this;
    const staging = this.stagingBranch;

    cli.log(`Looking for potential conflicts of ${rev}...`);
    const notBackported = this.getPotentialConflicts(rev, staging);

    if (notBackported.size === 0) {
      cli.info(`All ancestor commits of ${rev} have been backported`);
      return;
    }

    cli.warn(`The following ancestor commits of ${rev} are not on ${staging}`);
    for (const [commit, data] of notBackported) {
      cli.log(`  - ${commit} ${data.title}, ${data.url}`);
      for (const file of data.files) {
        cli.log(`    ${file}`);
      }
    }
  }

  async backport() {
    const { cli } = this;
    // TODO(joyeechuneg): add more warnings
    const { prid } = this;
    const url = getPrURL(this);
    cli.log(`Looking for commits of ${url} on main...`);

    const commits = this.getCommitsFromBranch(prid, 'main');

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
      ' to start backporting?', { defaultAnswer: false });
    if (shouldCheckout) {
      await runAsync('git', ['checkout', '-b', newBranch]);
    }

    const shouldAnalyze = await cli.prompt(
      'Do you want to analyze the dependencies of the commits? ' +
      '(this could take a while)');
    if (shouldAnalyze) {
      for (const commit of commits) {
        this.warnForPotentialConflicts(commit.sha);
      }
    }

    const cherries = commits.map(i => i.sha).reverse();
    const pendingCommands = [
      `git cherry-pick ${cherries.join(' ')}`,
      'git push -u <your-fork-remote> <your-branch-name>'
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
    let re;
    const url = getPrURL({ prid, repo: this.repo, owner: this.owner });
    re = `--grep=PR-URL: ${url}`;

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
      };
    });
  }
}
