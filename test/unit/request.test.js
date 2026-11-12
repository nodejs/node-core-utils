import { describe, it } from 'node:test';
import assert from 'node:assert';

import Request from '../../lib/request.js';

function createRequest(response) {
  const request = Object.create(Request.prototype);
  request.credentials = { github: 'credentials' };
  request.proxyAgent = undefined;
  request.json = async() => response;
  return request;
}

describe('Request', () => {
  describe('closePullRequest', () => {
    it('updates the pull request state with PATCH', async() => {
      const request = createRequest({});
      let requestOptions;
      request.json = async(url, options) => {
        assert.strictEqual(url, '/repos/nodejs/node/pulls/123');
        requestOptions = options;
        return {};
      };

      await request.closePullRequest(123, { owner: 'nodejs', repo: 'node' });

      assert.strictEqual(requestOptions.method, 'PATCH');
      assert.deepStrictEqual(JSON.parse(requestOptions.body), {
        state: 'closed'
      });
    });
  });

  describe('getTriagedReports', () => {
    it('fetches every page and includes overlapping reports only once', async() => {
      const request = createRequest({});
      request.credentials.h1 = 'h1-credentials';
      const calls = [];
      const next = 'https://api.hackerone.com/v1/reports?page[number]=2';
      request.json = async(url, options) => {
        calls.push(url);
        assert.strictEqual(options.method, 'GET');
        assert.strictEqual(options.redirect, 'error');
        assert.strictEqual(options.headers.Authorization, 'Basic h1-credentials');
        return calls.length === 1
          ? { data: [{ id: '1' }, { id: '2' }], links: { next } }
          : { data: [{ id: '2' }, { id: '3' }], links: { next: null } };
      };

      const result = await request.getTriagedReports();

      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[1], next);
      assert.deepStrictEqual(result.data, [{ id: '1' }, { id: '2' }, { id: '3' }]);
      assert.strictEqual(result.links.next, null);
    });

    it('accepts an empty list', async() => {
      const request = createRequest({ data: [] });
      assert.deepStrictEqual(await request.getTriagedReports(), { data: [] });
    });

    it('resolves relative next-page links', async() => {
      const request = createRequest({});
      let calls = 0;
      request.json = async(url) => {
        if (++calls === 1) {
          return { data: [{ id: '1' }], links: { next: '?page[number]=2' } };
        }
        assert.strictEqual(url, 'https://api.hackerone.com/v1/reports?page[number]=2');
        return { data: [{ id: '2' }] };
      };
      assert.strictEqual((await request.getTriagedReports()).data.length, 2);
    });

    it('rejects a failed later page instead of returning an incomplete list', async() => {
      const request = createRequest({});
      let calls = 0;
      request.json = async() => ++calls === 1
        ? { data: [{ id: '1' }], links: { next: '?page[number]=2' } }
        : { errors: [{ detail: 'Rate limit exceeded' }] };

      await assert.rejects(request.getTriagedReports(), /Rate limit exceeded/);
    });

    it('rejects malformed responses instead of treating them as empty pages', async() => {
      for (const response of [null, {}, { data: {} }]) {
        const request = createRequest(response);
        await assert.rejects(request.getTriagedReports(), /expected a data array/);
      }
    });

    it('does not send credentials to an unrelated pagination endpoint', async() => {
      for (const next of [
        'https://example.com/v1/reports',
        'http://api.hackerone.com/v1/reports',
        'https://api.hackerone.com/v1/users',
        'https://user@api.hackerone.com/v1/reports'
      ]) {
        const request = createRequest({});
        let calls = 0;
        request.json = async() => {
          calls++;
          return { data: [], links: { next } };
        };
        await assert.rejects(request.getTriagedReports(), /Invalid HackerOne reports pagination/);
        assert.strictEqual(calls, 1);
      }
    });

    it('rejects pagination loops', async() => {
      const request = createRequest({});
      let calls = 0;
      request.json = async(url) => {
        calls++;
        return { data: [{ id: '1' }], links: { next: url } };
      };
      await assert.rejects(request.getTriagedReports(), /Repeated HackerOne reports pagination/);
      assert.strictEqual(calls, 1);
    });
  });

  describe('query', () => {
    it('preserves detailed GraphQL errors', async() => {
      const variables = { owner: 'nodejs', repo: 'node', prid: 65130 };
      const errors = [
        {
          type: 'FORBIDDEN',
          path: [
            'repository', 'pullRequest', 'commits', 'nodes', 0, 'commit',
            'checkSuites', 'edges', 4, 'node', 'app'
          ],
          extensions: { saml_failure: false },
          locations: [{ line: 26, column: 7 }],
          message: 'Resource not accessible by integration'
        },
        {
          type: 'FORBIDDEN',
          path: ['repository', 'pullRequest', 'files'],
          locations: [{ line: 42, column: 5 }],
          message: 'A second error'
        }
      ];
      const request = createRequest({ errors });

      await assert.rejects(
        request.query('query PR { pullRequest { id } }', variables),
        (error) => {
          assert.strictEqual(
            error.message,
            '[FORBIDDEN] GraphQL request Error: ' +
              'Resource not accessible by integration');
          assert.deepStrictEqual(error.data, { variables, errors });
          return true;
        });
    });

    it('preserves top-level GraphQL API errors', async() => {
      const variables = { owner: 'nodejs', repo: 'node', prid: 65130 };
      const request = createRequest({ message: 'Bad credentials' });

      await assert.rejects(
        request.query('query PR { pullRequest { id } }', variables),
        (error) => {
          assert.strictEqual(
            error.message,
            'GraphQL request Error: Bad credentials');
          assert.deepStrictEqual(error.data, { variables });
          return true;
        });
    });
  });
});

describe('Request: OpenJS CNA', () => {
  function createCnaRequest(responder) {
    const calls = [];
    const request = createRequest({});
    request.credentials = {
      cna: {
        token: 'test_nodejs:0123456789abcdef',
        worker_url: 'https://worker.example.workers.dev'
      }
    };
    request.json = async(url, options) => {
      calls.push({ url, options });
      return responder(url, options, calls.length);
    };
    return { request, calls };
  }

  describe('cnaDispatch', () => {
    it('POSTs /dispatch with the bearer token and a JSON body', async() => {
      const { request, calls } = createCnaRequest(
        () => ({ correlation_id: 'abc-123', status: 'queued' })
      );

      const result = await request.cnaDispatch('reserve-cve');

      assert.deepStrictEqual(result, { correlation_id: 'abc-123', status: 'queued' });
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, 'https://worker.example.workers.dev/dispatch');
      assert.strictEqual(calls[0].options.method, 'POST');
      assert.strictEqual(calls[0].options.headers.Authorization,
        'Bearer test_nodejs:0123456789abcdef');
      assert.strictEqual(calls[0].options.headers['Content-Type'], 'application/json');
      assert.deepStrictEqual(JSON.parse(calls[0].options.body),
        { operation: 'reserve-cve', inputs: {} });
    });

    it('throws when the Worker returns an error envelope', async() => {
      const { request } = createCnaRequest(() => ({ error: 'unknown_operation' }));

      await assert.rejects(
        () => request.cnaDispatch('do-the-thing'),
        /OpenJS CNA dispatch failed \(do-the-thing\): unknown_operation/
      );
    });

    it('throws when the Worker returns no correlation id', async() => {
      const { request } = createCnaRequest(() => ({ status: 'queued' }));

      await assert.rejects(
        () => request.cnaDispatch('reserve-cve'),
        /returned no correlation_id/
      );
    });
  });

  describe('cnaPoll', () => {
    it('GETs /runs/{id} with the bearer token', async() => {
      const run = {
        correlation_id: 'abc-123',
        run_id: 999,
        status: 'completed',
        conclusion: 'success',
        result: { cve_id: 'CVE-2026-1234' }
      };
      const { request, calls } = createCnaRequest(() => run);

      const result = await request.cnaPoll('abc-123');

      assert.deepStrictEqual(result, run);
      assert.strictEqual(calls[0].url, 'https://worker.example.workers.dev/runs/abc-123');
      assert.strictEqual(calls[0].options.method, 'GET');
      assert.strictEqual(calls[0].options.headers.Authorization,
        'Bearer test_nodejs:0123456789abcdef');
    });

    it('throws when the Worker returns an error envelope', async() => {
      const { request } = createCnaRequest(() => ({ error: 'unauthorized' }));

      await assert.rejects(
        () => request.cnaPoll('abc-123'),
        /OpenJS CNA poll failed \(abc-123\): unauthorized/
      );
    });
  });

  describe('cnaWaitForCompletion', () => {
    it('polls until the run completes successfully', async() => {
      const { request, calls } = createCnaRequest((url, options, call) => {
        if (call === 1) return { status: 'in_progress' };
        return {
          run_id: 42,
          status: 'completed',
          conclusion: 'success',
          result: { cve_id: 'CVE-2026-1234' }
        };
      });

      const run = await request.cnaWaitForCompletion('abc-123',
        { timeoutMs: 1_000, intervalMs: 1 });

      assert.strictEqual(run.run_id, 42);
      assert.deepStrictEqual(run.result, { cve_id: 'CVE-2026-1234' });
      assert.strictEqual(calls.length, 2);
    });

    it('throws when the run concludes without success', async() => {
      const { request } = createCnaRequest(() => ({
        status: 'completed',
        conclusion: 'failure',
        url: 'https://github.com/example/runs/13'
      }));

      await assert.rejects(
        () => request.cnaWaitForCompletion('abc-123', { timeoutMs: 1_000, intervalMs: 1 }),
        /OpenJS CNA run abc-123 concluded with 'failure'. See https:\/\/github.com\/example\/runs\/13/
      );
    });

    it('throws a CnaTimeoutError carrying the correlation id on timeout', async() => {
      const { request } = createCnaRequest(() => ({ status: 'in_progress' }));

      await assert.rejects(
        () => request.cnaWaitForCompletion('abc-123', { timeoutMs: 5, intervalMs: 1 }),
        (error) => {
          assert.strictEqual(error.name, 'CnaTimeoutError');
          assert.strictEqual(error.correlationId, 'abc-123');
          assert.match(error.message, /did not complete within 5ms/);
          return true;
        }
      );
    });
  });
});
