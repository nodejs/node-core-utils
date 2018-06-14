
'use strict';

const CIFailureParser = require('../../lib/ci_failure_parser');
const fixtures = require('../fixtures');
const assert = require('assert');
const { raw } = require('../common');

describe('CIFailureParser', () => {
  const url = 'https://ci.nodejs.org/job/node-test-commit/19225';
  const file = 'node-test-commit-linuxone-label=rhel72-s390x-2220.txt';
  const text = fixtures.readFile('jenkins', 'build-failure-git-fetch', file);
  const parser = new CIFailureParser(url, text);
  const result = parser.parse();
  const expectedJson = fixtures.readJSON(
    'jenkins', 'build-failure-git-fetch', 'expected.json'
  );
  assert.deepStrictEqual(raw(result), expectedJson);
});
