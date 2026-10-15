import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PRBuild } from '../../lib/ci/build-types/pr_build.js';
import TestCLI from '../fixtures/test_cli.js';

function buildData() {
  return {
    result: 'FAILURE',
    actions: [{
      parameters: [
        { name: 'TARGET_GITHUB_ORG', value: 'nodejs' },
        { name: 'TARGET_REPO_NAME', value: 'node' },
        { name: 'PR_ID', value: '123' },
        { name: 'REBASE_ONTO', value: '<pr base branch>' }
      ]
    }],
    changeSet: { items: [] },
    timestamp: 0,
    subBuilds: [{ buildNumber: 456, build: { subBuilds: [] } }]
  };
}

describe('PR target branch reporting', () => {
  for (const targetBranch of ['main', 'v24.x', 'release/example']) {
    it(`retains the recorded target ${targetBranch} in failure JSON`, async() => {
      const data = buildData();
      data.subBuilds[0].build.actions = [{}, {
        parameters: [
          { name: 'REBASE_ONTO', value: 'origin/another-branch' },
          { name: 'PR_BASE_BRANCH', value: targetBranch }
        ]
      }];
      const request = {
        async json(url) {
          assert.ok(new URL(url).searchParams.get('tree')
            .includes('build[actions[parameters[name,value]],subBuilds['));
          return data;
        }
      };
      const build = new PRBuild(new TestCLI(), request, 123);
      await build.getResults();

      const failures = build.formatAsJson();
      assert.equal(failures.length, 1);
      assert.equal(failures[0].targetBranch, targetBranch);
      assert.equal(failures[0].source, 'https://github.com/nodejs/node/pull/123/');
      assert.equal(failures[0].upstream, build.jobUrl);
      assert.equal(failures[0].reason, 'Failed to trigger sub builds');
      // Nested parameters must not replace the PR job's parameters or actions.
      assert.equal(build.commitBuild.params.REBASE_ONTO, '<pr base branch>');
      assert.equal(Object.hasOwn(build.failures[0], 'targetBranch'), false);
    });
  }

  for (const scenario of [
    'missing actions', 'missing parameter', 'empty branch', 'invalid branch',
    'unavailable commit build', 'untriggered commit build'
  ]) {
    it(`omits targetBranch for ${scenario}`, async(t) => {
      const data = buildData();
      // Parent parameters must not substitute for the nested build's metadata.
      data.actions[0].parameters.push({ name: 'PR_BASE_BRANCH', value: 'wrong' });
      switch (scenario) {
        case 'missing parameter':
          data.subBuilds[0].build.actions = [{}, { parameters: [] }];
          break;
        case 'empty branch':
        case 'invalid branch':
          data.subBuilds[0].build.actions = [{
            parameters: [{
              name: 'PR_BASE_BRANCH',
              value: scenario === 'empty branch' ? '' : null
            }]
          }];
          break;
        case 'unavailable commit build':
          data.subBuilds[0].build = null;
          break;
        case 'untriggered commit build':
          data.subBuilds = [];
          break;
      }
      const build = new PRBuild(new TestCLI(), {}, 123);
      t.mock.method(build, 'getBuildData', async() => data);
      await build.getResults();

      const failures = build.formatAsJson();
      assert.equal(failures.length, 1);
      assert.equal(Object.hasOwn(failures[0], 'targetBranch'), false);
    });
  }
});
