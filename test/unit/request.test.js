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
