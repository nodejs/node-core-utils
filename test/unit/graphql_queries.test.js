import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert';

const prQuery = readFileSync(
  new URL('../../lib/queries/PR.gql', import.meta.url), 'utf8');
const commitsQuery = readFileSync(
  new URL('../../lib/queries/PRCommits.gql', import.meta.url), 'utf8');

describe('GraphQL queries', () => {
  it('requests CI details only for the pull request head commit', () => {
    const headCommitStart = prQuery.indexOf(
      'headCommit: commits(last: 1)');
    const headCommitEnd = prQuery.indexOf('\n      title,', headCommitStart);
    const headCommitQuery = prQuery.slice(headCommitStart, headCommitEnd);

    assert.notStrictEqual(headCommitStart, -1);
    assert.notStrictEqual(headCommitEnd, -1);
    assert.match(
      headCommitQuery,
      /checkSuites\(first: 100, filterBy: \{ appId: 15368 \}\)/);
    assert.match(headCommitQuery, /checkRuns\(first: 40\)/);
    assert.match(headCommitQuery, /status \{\s+state\s+\}/);
    assert.doesNotMatch(headCommitQuery, /\bapp\s*\{/);
    assert.doesNotMatch(commitsQuery, /checkSuites/);
    assert.doesNotMatch(commitsQuery, /checkRuns/);
    assert.doesNotMatch(commitsQuery, /\sstatus\s*\{/);
  });
});
