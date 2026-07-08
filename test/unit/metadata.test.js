import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  formatMetadataResult,
  METADATA_EXIT_CODES,
  METADATA_READINESS
} from '../../components/metadata.js';
import {
  writeMetadataJsonResult
} from '../../components/git/metadata.js';
import {
  PR_CHECK_REASON_CODES
} from '../../lib/pr_checker.js';

describe('metadata command helpers', () => {
  it('formats ready metadata JSON output with unique reason codes', () => {
    const reason = {
      code: PR_CHECK_REASON_CODES.WAIT_TIME,
      message: 'This PR needs to wait 24 more hours to land'
    };
    const result = formatMetadataResult({
      status: true,
      data: {
        owner: 'nodejs',
        repo: 'node',
        prid: 12345,
        pr: {
          url: 'https://github.com/nodejs/node/pull/12345'
        }
      },
      metadata: 'PR-URL: https://github.com/nodejs/node/pull/12345\n',
      checker: {
        reasons: [reason, reason]
      }
    });

    assert.deepStrictEqual(result, {
      ready: true,
      readiness: METADATA_READINESS.READY,
      exitCode: METADATA_EXIT_CODES.READY,
      pullRequest: {
        owner: 'nodejs',
        repo: 'node',
        number: 12345,
        url: 'https://github.com/nodejs/node/pull/12345'
      },
      metadata: 'PR-URL: https://github.com/nodejs/node/pull/12345\n',
      reasonCodes: [PR_CHECK_REASON_CODES.WAIT_TIME],
      reasons: [reason, reason]
    });
  });

  it('classifies metadata JSON output with deferrable reasons', () => {
    const result = formatMetadataResult({
      status: false,
      data: {
        owner: 'nodejs',
        repo: 'node',
        prid: 12345,
        pr: {
          url: 'https://github.com/nodejs/node/pull/12345'
        }
      },
      metadata: 'PR-URL: https://github.com/nodejs/node/pull/12345\n',
      checker: {
        reasons: [
          {
            code: PR_CHECK_REASON_CODES.MISSING_APPROVAL,
            message: 'Approvals: 0'
          },
          {
            code: PR_CHECK_REASON_CODES.WAIT_TIME,
            message: 'This PR needs to wait 24 more hours to land'
          }
        ]
      }
    });

    assert.strictEqual(result.readiness, METADATA_READINESS.DEFERRABLE);
    assert.strictEqual(result.exitCode, METADATA_EXIT_CODES.DEFERRABLE);
  });

  it('classifies mixed metadata JSON output as failed', () => {
    const result = formatMetadataResult({
      status: false,
      data: {
        owner: 'nodejs',
        repo: 'node',
        prid: 12345,
        pr: {
          url: 'https://github.com/nodejs/node/pull/12345'
        }
      },
      metadata: 'PR-URL: https://github.com/nodejs/node/pull/12345\n',
      checker: {
        reasons: [
          {
            code: PR_CHECK_REASON_CODES.WAIT_TIME,
            message: 'This PR needs to wait 24 more hours to land'
          },
          {
            code: PR_CHECK_REASON_CODES.CONFLICT,
            message: 'This PR has conflicts that must be resolved'
          }
        ]
      }
    });

    assert.strictEqual(result.readiness, METADATA_READINESS.FAILED);
    assert.strictEqual(result.exitCode, METADATA_EXIT_CODES.FAILED);
  });

  it('writes metadata JSON output before setting the exit code', async(t) => {
    const originalWrite = process.stdout.write;
    const originalExitCode = process.exitCode;
    const written = [];

    t.after(() => {
      process.stdout.write = originalWrite;
      process.exitCode = originalExitCode;
    });

    process.stdout.write = (chunk, encoding, callback) => {
      written.push(chunk.toString());
      const cb = typeof encoding === 'function' ? encoding : callback;
      cb?.();
      return true;
    };

    const json = {
      ready: false,
      readiness: METADATA_READINESS.DEFERRABLE,
      exitCode: METADATA_EXIT_CODES.DEFERRABLE
    };

    await writeMetadataJsonResult(Promise.resolve({ json }));

    assert.deepStrictEqual(JSON.parse(written.join('')), json);
    assert.strictEqual(process.exitCode, METADATA_EXIT_CODES.DEFERRABLE);
  });
});
