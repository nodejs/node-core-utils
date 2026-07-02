import { describe, it } from 'node:test';
import assert from 'node:assert';
import Request from '../../lib/request.js';

const CREDENTIALS = {
  cna: {
    token: 'test_nodejs:0123456789abcdef',
    worker_url: 'https://worker.example.workers.dev'
  }
};

const createMockRequest = (responder) => {
  const calls = [];
  const req = new Request(CREDENTIALS);
  req.json = async (url, options) => {
    calls.push({ url, options });
    return responder(url, options);
  };
  return { req, calls };
};

describe('Request#cnaDispatch', () => {
  it('POSTs /dispatch with the bearer token and JSON body', async () => {
    const { req, calls } = createMockRequest(
      () => ({ correlation_id: 'abc-123', status: 'queued' })
    );
    const result = await req.cnaDispatch('reserve-cve', { foo: 'bar' });
    assert.deepStrictEqual(result, { correlation_id: 'abc-123', status: 'queued' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url,
      'https://worker.example.workers.dev/dispatch');
    assert.strictEqual(calls[0].options.method, 'POST');
    assert.strictEqual(calls[0].options.headers.Authorization,
      'Bearer test_nodejs:0123456789abcdef');
    assert.deepStrictEqual(
      JSON.parse(calls[0].options.body),
      { operation: 'reserve-cve', inputs: { foo: 'bar' } }
    );
  });

  it('throws when the Worker returns an error envelope', async () => {
    const { req } = createMockRequest(
      () => ({ error: 'unknown_operation' })
    );
    await assert.rejects(
      () => req.cnaDispatch('do-the-thing'),
      /OpenJS CNA dispatch failed \(do-the-thing\): unknown_operation/
    );
  });
});

describe('Request#cnaPoll', () => {
  it('GETs /runs/{id} with the bearer token', async () => {
    const { req, calls } = createMockRequest(() => ({
      correlation_id: 'abc-123',
      run_id: 999,
      status: 'completed',
      conclusion: 'success',
      url: 'https://github.com/.../runs/999',
      result: { cve_id: 'CVE-2026-1234' }
    }));
    const result = await req.cnaPoll('abc-123');
    assert.strictEqual(result.status, 'completed');
    assert.deepStrictEqual(result.result, { cve_id: 'CVE-2026-1234' });
    assert.strictEqual(calls[0].url,
      'https://worker.example.workers.dev/runs/abc-123');
    assert.strictEqual(calls[0].options.method, 'GET');
  });
});

describe('Request#cnaWaitForCompletion', () => {
  it('returns the run when status is completed and conclusion is success', async () => {
    let i = 0;
    const { req, calls } = createMockRequest(() => {
      i += 1;
      if (i === 1) return { status: 'in_progress' };
      return {
        correlation_id: 'abc-123',
        run_id: 42,
        status: 'completed',
        conclusion: 'success',
        url: 'https://github.com/.../runs/42',
        result: { cve_id: 'CVE-2026-1234' }
      };
    });
    const run = await req.cnaWaitForCompletion('abc-123',
      { timeoutMs: 1_000, intervalMs: 10 });
    assert.strictEqual(run.run_id, 42);
    assert.deepStrictEqual(run.result, { cve_id: 'CVE-2026-1234' });
    assert.strictEqual(calls.length, 2);
  });

  it('throws when conclusion is failure', async () => {
    const { req } = createMockRequest(() => ({
      status: 'completed',
      conclusion: 'failure',
      url: 'https://github.com/.../runs/13'
    }));
    await assert.rejects(
      () => req.cnaWaitForCompletion('abc-123',
        { timeoutMs: 1_000, intervalMs: 10 }),
      /OpenJS CNA run abc-123 concluded with 'failure'/
    );
  });

  it('throws on timeout', async () => {
    const { req } = createMockRequest(() => ({ status: 'in_progress' }));
    await assert.rejects(
      () => req.cnaWaitForCompletion('abc-123',
        { timeoutMs: 30, intervalMs: 10 }),
      /did not complete within 30ms/
    );
  });
});

describe('Request#cnaReserveCve', () => {
  it('returns the reserved CVE id from the Worker result field', async () => {
    let i = 0;
    const { req } = createMockRequest(() => {
      i += 1;
      if (i === 1) return { correlation_id: 'abc-123', status: 'queued' };
      return {
        correlation_id: 'abc-123',
        run_id: 42,
        status: 'completed',
        conclusion: 'success',
        url: 'https://github.com/.../runs/42',
        result: { cve_id: 'CVE-2026-1234' }
      };
    });
    const reserved = await req.cnaReserveCve({ timeoutMs: 1_000, intervalMs: 10 });
    assert.strictEqual(reserved.result.cve_id, 'CVE-2026-1234');
    assert.strictEqual(reserved.run_id, 42);
  });
});

describe('Request#cnaPublishCve', () => {
  it('dispatches publish-cve with the cve_id and cnaContainer payload', async () => {
    let i = 0;
    const { req, calls } = createMockRequest(() => {
      i += 1;
      if (i === 1) return { correlation_id: 'def-456', status: 'queued' };
      return {
        correlation_id: 'def-456',
        run_id: 99,
        status: 'completed',
        conclusion: 'success',
        url: 'https://github.com/.../runs/99',
        result: { cve_id: 'CVE-2026-9999', published: true }
      };
    });
    const container = {
      title: 'demo',
      descriptions: [{ lang: 'en', value: 'demo' }]
    };
    const published = await req.cnaPublishCve('CVE-2026-9999', container,
      { timeoutMs: 1_000, intervalMs: 10 });
    assert.strictEqual(published.result.cve_id, 'CVE-2026-9999');
    assert.strictEqual(published.result.published, true);
    // First call is the dispatch; verify the body carried both the cve_id and
    // the CNA Container payload so the workflow can hand them to MITRE as-is.
    const dispatchBody = JSON.parse(calls[0].options.body);
    assert.strictEqual(dispatchBody.operation, 'publish-cve');
    assert.strictEqual(dispatchBody.inputs.cve_id, 'CVE-2026-9999');
    assert.deepStrictEqual(dispatchBody.inputs.cnaContainer, container);
  });
});
