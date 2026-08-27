import assert from 'node:assert';
import { describe, it } from 'node:test';

import { FailureAggregator } from '../../lib/ci/failure_aggregator.js';

const health = { type: 'health' };

/**
 * Builds a JS test failure as produced by the CI parsers, where `file` is the
 * test name reported by the runner and `source` is the pull request that
 * triggered the run.
 */
function failure(prid, file, jobid) {
  return {
    type: 'JS_TEST_FAILURE',
    reason: `not ok 1 ${file}\n  ---\n  severity: fail\n`,
    highlight: 0,
    file,
    source: `https://github.com/nodejs/node/pull/${prid}/`,
    upstream: `https://ci.nodejs.org/job/node-test-pull-request/${jobid}/`,
    builtOn: `test-machine-${jobid}`,
    url: `https://ci.nodejs.org/job/node-test-commit/${jobid}/console`
  };
}

/**
 * Stubs the parts of the request client the aggregator relies on. `changed`
 * maps a pull request number to the files it modified.
 */
function requestStub(changed) {
  return {
    async * getPullRequestFiles({ prid }) {
      for (const filename of changed[prid] ?? []) {
        yield { filename };
      }
    }
  };
}

const cli = { warn() {} };

describe('FailureAggregator', () => {
  it('should not count a failure in a test the pull request modified', async() => {
    const request = requestStub({
      65113: ['lib/fs.js'],
      65233: ['test/ffi/test-ffi-fast-buffer.js']
    });

    const aggregator = new FailureAggregator(cli, [
      health,
      failure(65113, 'ffi/test-ffi-fast-buffer', 75793),
      failure(65233, 'ffi/test-ffi-fast-buffer', 75799)
    ], request);

    const aggregates = await aggregator.aggregate();
    const [entry] = aggregates.JS_TEST_FAILURE;

    assert.strictEqual(entry.prs.length, 1);
    assert.strictEqual(
      entry.prs[0].source,
      'https://github.com/nodejs/node/pull/65113/'
    );
  });

  it('should keep failures in tests the pull request left alone', async() => {
    const request = requestStub({
      65113: ['lib/fs.js'],
      65233: ['src/ffi/fast.cc']
    });

    const aggregator = new FailureAggregator(cli, [
      health,
      failure(65113, 'ffi/test-ffi-fast-buffer', 75793),
      failure(65233, 'ffi/test-ffi-fast-buffer', 75799)
    ], request);

    const aggregates = await aggregator.aggregate();
    const [entry] = aggregates.JS_TEST_FAILURE;

    assert.strictEqual(entry.prs.length, 2);
  });

  it('should keep the occurrence when the changed files cannot be fetched', async() => {
    const request = {
      getPullRequestFiles() {
        throw new Error('network is down');
      }
    };

    const aggregator = new FailureAggregator(cli, [
      health,
      failure(65233, 'ffi/test-ffi-fast-buffer', 75799)
    ], request);

    const aggregates = await aggregator.aggregate();
    const [entry] = aggregates.JS_TEST_FAILURE;

    assert.strictEqual(entry.prs.length, 1);
  });

  it('should leave failures without a test file untouched', async() => {
    const request = requestStub({ 65233: ['test/ffi/test-ffi-fast-buffer.js'] });

    const buildFailure = {
      type: 'BUILD_FAILURE',
      reason: 'fatal: could not read Username',
      highlight: 0,
      source: 'https://github.com/nodejs/node/pull/65233/',
      upstream: 'https://ci.nodejs.org/job/node-test-pull-request/75799/',
      builtOn: 'test-machine',
      url: 'https://ci.nodejs.org/job/node-test-commit/75799/console'
    };

    const aggregator = new FailureAggregator(
      cli, [health, buildFailure], request);

    const aggregates = await aggregator.aggregate();
    const [entry] = aggregates.BUILD_FAILURE;

    assert.strictEqual(entry.prs.length, 1);
  });
});
