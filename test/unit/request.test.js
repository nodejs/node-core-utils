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
