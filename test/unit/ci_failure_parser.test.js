import assert from 'node:assert';

import CIFailureParser from '../../lib/ci/ci_failure_parser.js';

import * as fixtures from '../fixtures/index.js';
import { raw } from '../common.js';

describe('Jenkins', () => {
  it('should parse git failure', async() => {
    const text =
      fixtures.readFile('jenkins', 'git-failure-2', 'console.txt');
    const parser = new CIFailureParser({
      url: 'https://ci.nodejs.org/job/node-test-commit-linuxone/nodes=rhel72-s390x/3915/console',
      builtOn: 'test-linuxonecc-rhel72-s390x-3'
    }, text);
    const actual = parser.parse();
    const expected =
      fixtures.readJSON('jenkins', 'git-failure-2', 'expected.json');
    assert.deepStrictEqual(raw(actual), expected);
  });
});
