import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NormalBuild } from '../../lib/ci/build-types/normal_build.js';
import TestCLI from '../fixtures/test_cli.js';

const jobName = 'node-test-commit-osx';
const jobURL = `https://ci.nodejs.org/job/${jobName}/`;
const currentURL = `${jobURL}nodes=macos15-x64/73204/`;
const failureLog = 'not ok 1 parallel/test-example\n' +
  '  ---\n  severity: fail\n  stack: |-\n    AssertionError\n  ...\n';

describe('Jenkins matrix failure reporting', () => {
  for (const { name, upstreamBuild, reportRun } of [
    { name: 'ignores an older run', upstreamBuild: 73203, reportRun: false },
    { name: 'ignores a build-number prefix', upstreamBuild: 7320, reportRun: false },
    { name: 'ignores a build-number suffix', upstreamBuild: 3204, reportRun: false },
    { name: 'keeps runs without an upstream cause', reportRun: true }
  ]) {
    it(name, async(t) => {
      const otherURL = `${jobURL}nodes=osx13-x64/${upstreamBuild ?? 73204}/`;
      const responses = new Map([
        [`${jobURL}73204/api/json`, {
          result: 'FAILURE',
          runs: [
            { number: 73204, result: 'FAILURE', url: currentURL },
            { number: upstreamBuild ?? 73204, result: 'FAILURE', url: otherURL }
          ]
        }],
        [`${currentURL}api/json`, {
          builtOn: 'current-worker',
          actions: [{}, {
            causes: [{ upstreamBuild: 73204, upstreamProject: jobName }]
          }]
        }],
        [`${otherURL}api/json`, {
          builtOn: 'other-worker',
          actions: upstreamBuild === undefined
            ? []
            : [{}, {
                causes: [{ upstreamBuild, upstreamProject: jobName }]
              }]
        }]
      ]);
      const request = {
        async json(url) {
          const key = url.split('?')[0];
          assert.ok(responses.has(key), `Unexpected JSON request: ${url}`);
          return responses.get(key);
        },
        text: t.mock.fn(async() => failureLog)
      };
      const build = new NormalBuild(new TestCLI(), request, jobName, 73204);
      const failures = await build.getResults();
      const expectedURLs = reportRun ? [currentURL, otherURL] : [currentURL];

      assert.deepEqual(failures.map(failure => ({
        url: failure.url,
        type: failure.type,
        file: failure.file
      })), expectedURLs.map(url => ({
        url: `${url}console`,
        type: 'JS_TEST_FAILURE',
        file: 'parallel/test-example'
      })));
      assert.deepEqual(
        request.text.mock.calls.map(call => call.arguments),
        expectedURLs.map(url => [`${url}consoleText`])
      );
    });
  }
});
