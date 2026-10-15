import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FailureAggregator } from '../../lib/ci/failure_aggregator.js';
import TestCLI from '../fixtures/test_cli.js';

function failure(prid, jobid, targetBranch, reason = 'Example failure') {
  return {
    source: `https://github.com/nodejs/node/pull/${prid}/`,
    upstream: `https://ci.nodejs.org/job/node-test-pull-request/${jobid}/`,
    url: `https://ci.nodejs.org/job/node-test-commit-linux/${jobid}/console`,
    type: 'BUILD_FAILURE',
    reason,
    highlight: 0,
    builtOn: 'test-worker',
    ...(targetBranch === undefined ? {} : { targetBranch })
  };
}

const health = { formatAsMarkdown: () => 'Health summary\n' };

describe('Failure aggregation target branches', () => {
  it('preserves branches across runs without changing PR counts or CI ordering', () => {
    const cli = new TestCLI();
    const failures = [
      failure(1, 105, 'main'),
      failure(1, 104, 'v24.x'),
      failure(1, 103, 'main'),
      failure(2, 102, 'v22.x'),
      failure(3, 101, 'main', 'Another failure')
    ];
    const aggregator = new FailureAggregator(cli, [health, ...failures]);
    const groups = aggregator.aggregate().BUILD_FAILURE;
    assert.deepEqual(groups.map(group => group.prs.length), [2, 1]);
    assert.deepEqual(groups[0].prs.map(pr => ({
      source: pr.source, upstream: pr.upstream, targetBranches: pr.targetBranches
    })), [
      { source: failures[3].source, upstream: failures[3].upstream, targetBranches: ['v22.x'] },
      {
        source: failures[0].source,
        upstream: failures[0].upstream,
        targetBranches: ['main', 'v24.x']
      }
    ]);

    const markdown = aggregator.formatAsMarkdown();
    assert.ok(markdown.includes('| Failed PR | 2 (' +
      `[${failures[3].source}](${failures[3].upstream}) (target: v22.x), ` +
      `[${failures[0].source}](${failures[0].upstream}) (target: main, v24.x)) |`));
    assert.ok(markdown.includes(`| First CI | ${failures[3].upstream} |`));
    assert.ok(markdown.includes(`| Last CI | ${failures[0].upstream} |`));
    assert.ok(markdown.includes('Health summary\n'));
    assert.ok(markdown.endsWith('### Progress\n\n- [ ] `Example failure` (2)\n'));
    assert.equal(markdown.includes('Another failure'), false);

    aggregator.display();
    assert.deepEqual(cli._calls.table.filter(([key]) => key === 'Failed PR'), [
      ['Failed PR', '2 (#2 (target: v22.x), #1 (target: main, v24.x))'],
      ['Failed PR', '1 (#3 (target: main))']
    ]);
  });

  it('reports missing metadata as unknown alongside recorded branches', () => {
    const cli = new TestCLI();
    const aggregator = new FailureAggregator(cli, [health,
      failure(1, 104), failure(1, 103, 'main'), failure(1, 102), failure(2, 101)
    ]);
    const markdown = aggregator.formatAsMarkdown();
    assert.ok(markdown.includes('(target: unknown, main)'));
    assert.ok(markdown.includes('(target: unknown)'));
    aggregator.display();
    assert.deepEqual(cli._calls.table.find(([key]) => key === 'Failed PR'),
      ['Failed PR', '2 (#2 (target: unknown), #1 (target: unknown, main))']);
  });

  it('escapes Markdown and HTML in branch names while preserving terminal text', () => {
    const branch = 'feature/a|b`c&<d>_e_(f)';
    const cli = new TestCLI();
    const aggregator = new FailureAggregator(cli, [health,
      failure(1, 102, branch), failure(2, 101, 'main')
    ]);
    const markdown = aggregator.formatAsMarkdown();
    const escaped = 'feature/a&#124;b&#96;c&#38;&#60;d&#62;&#95;e&#95;&#40;f&#41;';
    assert.ok(markdown.includes(`(target: ${escaped})`));
    assert.equal(markdown.includes(branch), false);
    aggregator.display();
    assert.ok(cli._calls.table.find(([key]) => key === 'Failed PR')[1].includes(branch));
  });

  it('leaves non-PR sources unannotated', () => {
    const failures = [failure(1, 102), failure(2, 101)];
    for (const [index, item] of failures.entries()) {
      item.source = `https://api.github.com/repos/nodejs/node/git/commit-${index}`;
    }
    const aggregator = new FailureAggregator(new TestCLI(), [health, ...failures]);
    const markdown = aggregator.formatAsMarkdown();
    assert.equal(markdown.includes('target:'), false);
    assert.ok(markdown.includes(`[${failures[0].source}](${failures[0].upstream})`));
  });
});
