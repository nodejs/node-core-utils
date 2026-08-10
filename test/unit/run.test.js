import { describe, it } from 'node:test';
import assert from 'node:assert';

import { reportError } from '../../lib/run.js';

describe('reportError', () => {
  it('renders structured error data as formatted JSON', () => {
    const error = new Error(
      '[FORBIDDEN] GraphQL request Error: Resource not accessible');
    error.data = {
      variables: { owner: 'nodejs', repo: 'node', prid: 65130 },
      errors: [{
        type: 'FORBIDDEN',
        path: ['repository', 'pullRequest', 'checkSuites', 0, 'app'],
        locations: [{ line: 26, column: 7 }],
        extensions: { saml_failure: false },
        message: 'Resource not accessible'
      }]
    };
    const output = [];

    reportError(error, (value) => output.push(value));

    assert.deepStrictEqual(output, [
      error.stack,
      JSON.stringify(error.data, null, 2)
    ]);
  });

  it('renders errors without structured data once', () => {
    const error = new Error('boom');
    const output = [];

    reportError(error, (value) => output.push(value));

    assert.deepStrictEqual(output, [error.stack]);
  });
});
