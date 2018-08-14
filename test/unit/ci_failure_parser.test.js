'use strict';

const CIFailureParser = require('../../lib/ci/ci_failure_parser');
const fixtures = require('../fixtures');
const { raw } = require('../common');

const assert = require('assert');

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
