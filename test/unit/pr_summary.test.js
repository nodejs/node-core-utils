import PRSummary from '../../lib/pr_summary.js';

import {
  oddCommits,
  simpleCommits,
  firstTimerPR,
  semverMajorPR,
  emptyProfilePR
} from '../fixtures/data.js';
import TestCLI from '../fixtures/test_cli.js';

describe('PRSummary', () => {
  const argv = { prid: 16348, owner: 'nodejs', repo: 'node' };

  it('#display() first timer with odd commits', () => {
    const cli = new TestCLI();
    const prData = {
      pr: firstTimerPR,
      commits: oddCommits,
      authorIsNew() {
        return true;
      }
    };
    const summary = new PRSummary(argv, cli, prData);

    const expectedLogs = {
      log: [
        // commits
        [' - doc: some changes'],
        [' - doc: some changes 2'],
        [' - test: some changes'],
        [' - test: some changes 2'],
        [' - [squash] fix typo'],
        [' - fixup! fix something'],
        // committers
        [' - Their Github Account email <pr_author@example.com>'],
        [' - GitHub <noreply@github.com>'],
        [' - Baz User <baz@example.com>']
      ],
      table: [
        ['Title', 'test: awesome changes (#16348)'],
        ['Author',
          'Their Github Account email <pr_author@example.com>' +
          ' (@pr_author, first-time contributor)'],
        ['Branch', 'pr_author:awesome-changes -> nodejs:master'],
        ['Labels', 'needs-ci, test, doc'],
        ['Commits', '6'],
        ['Committers', '3']
      ]
    };

    summary.display();
    cli.assertCalledWith(expectedLogs);
  });

  it('#display() old timer with simple commits', () => {
    const cli = new TestCLI();
    const prData = {
      pr: semverMajorPR,
      commits: simpleCommits,
      authorIsNew() {
        return false;
      }
    };
    const summary = new PRSummary(argv, cli, prData);

    const expectedLogs = {
      log: [
        // commits
        [' - doc: some changes'],
        // committers
        [' - Their Github Account email <pr_author@example.com>']
      ],
      table: [
        ['Title', 'lib: awesome changes (#16348)'],
        ['Author',
          'Their Github Account email <pr_author@example.com>' +
          ' (@pr_author)'],
        ['Branch', 'pr_author:awesome-changes -> nodejs:master'],
        ['Labels', 'semver-major'],
        ['Commits', '1'],
        ['Committers', '1']
      ]
    };

    summary.display();
    cli.assertCalledWith(expectedLogs);
  });

  it('displays warning if pr author/email is not present', () => {
    const cli = new TestCLI();
    const prData = {
      pr: emptyProfilePR,
      commits: simpleCommits,
      authorIsNew() {
        return false;
      }
    };

    const expectedLogs = {
      log: [
        [' - doc: some changes'],
        [' - Their Github Account email <pr_author@example.com>']
      ],
      table: [
        ['Title', 'doc: fix mdn links (#16348)'],
        ['Branch', 'pr_author:fix-links -> nodejs:master'],
        ['Labels', 'doc'],
        ['Commits', '1'],
        ['Committers', '1']
      ],
      warn: [
        ['Could not retrieve the email or name ' +
        "of the PR author's from user's GitHub profile!"]
      ]
    };

    const summary = new PRSummary(argv, cli, prData);
    summary.display();
    cli.assertCalledWith(expectedLogs);
  });
});
