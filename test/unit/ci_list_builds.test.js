import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listBuilds } from '../../lib/ci/ci_utils.js';
import { CI_TYPES, CI_TYPES_KEYS } from '../../lib/ci/ci_type_parser.js';
import TestCLI from '../fixtures/test_cli.js';

const { PR, COMMIT } = CI_TYPES_KEYS;
const results = ['SUCCESS', 'FAILURE', 'ABORTED', 'UNSTABLE', null];

function build(type, jobid, result, owner, timestamp = 200) {
  const { jobName } = CI_TYPES.get(type);
  return {
    url: `https://ci.nodejs.org/job/${jobName}/${jobid}/`,
    result,
    timestamp,
    ...(owner === undefined
      ? {}
      : {
          actions: [{}, {
            parameters: [{
              name: type === PR ? 'TARGET_GITHUB_ORG' : 'GITHUB_ORG',
              value: owner
            }]
          }]
        })
  };
}

function requestFor(builds) {
  return {
    async json(url) {
      assert.equal(new URL(url).searchParams.get('tree'),
        'builds[url,result,timestamp,actions[parameters[name,value]]]');
      return { builds };
    }
  };
}

function jobids(builds) {
  return Object.fromEntries(Object.entries(builds).map(([key, value]) =>
    [key, key === 'count' ? value : value.map(build => build.jobid)]));
}

describe('Reliability build listings', () => {
  for (const type of [PR, COMMIT]) {
    it(`excludes private ${type} builds from every result and the total`, async() => {
      const builds = results.flatMap((result, index) => [
        build(type, index + 1, result, 'nodejs'),
        build(type, index + 101, result, index % 2 ? 'NODEJS-PRIVATE' : 'nodejs-private')
      ]);
      builds.push(
        build(type, 6, 'FAILURE', 'panva'),
        build(type, 7, 'FAILURE', 'nodejs-private-extra'),
        build(type, 8, 'FAILURE'),
        { ...build(type, 9, 'FAILURE'), actions: [{}] },
        {
          ...build(type, 10, 'FAILURE'), actions: [{
            parameters: [
              { name: 'BRANCH', value: 'nodejs-private' }
            ]
          }]
        }
      );

      assert.deepEqual(jobids(await listBuilds(new TestCLI(), requestFor(builds), type)), {
        success: [1],
        failed: [2, 6, 7, 8, 9, 10],
        aborted: [3],
        pending: [5],
        unstable: [4],
        count: 10
      });
    });

    it(`retains the since cutoff while excluding private ${type} builds`, async() => {
      const builds = [
        build(type, 1, 'FAILURE', 'nodejs', 100),
        build(type, 2, 'FAILURE', 'nodejs', 150),
        build(type, 3, 'FAILURE', 'nodejs', 200),
        build(type, 4, 'FAILURE', 'nodejs-private', 300)
      ];
      const filtered = await listBuilds(new TestCLI(), requestFor(builds), type, new Date(150));
      assert.deepEqual(filtered.failed.map(build => build.jobid), [3]);
      assert.equal(filtered.count, 1);
    });

    it(`returns empty result buckets when all ${type} builds are private`, async() => {
      const builds = results.map((result, index) =>
        build(type, index + 1, result, 'nodejs-private'));
      assert.deepEqual(jobids(await listBuilds(new TestCLI(), requestFor(builds), type)), {
        success: [], failed: [], aborted: [], pending: [], unstable: [], count: 0
      });
    });
  }
});
