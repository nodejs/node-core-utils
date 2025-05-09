/* eslint-disable import/no-named-as-default-member */
import { describe, it, before, afterEach } from 'node:test';
import assert from 'assert';

import sinon from 'sinon';
import { FormData } from 'undici';

import {
  RunPRJob,
  CI_CRUMB_URL,
  CI_PR_URL,
  CI_V8_URL
} from '../../lib/ci/run_ci.js';
import PRChecker from '../../lib/pr_checker.js';

import TestCLI from '../fixtures/test_cli.js';

describe('Jenkins', () => {
  const owner = 'nodejs';
  const repo = 'node-auto-test';
  const prid = 123456;
  const crumb = 'asdf1234';

  before(() => {
    sinon.stub(FormData.prototype, 'append').callsFake(function(key, value) {
      assert.strictEqual(key, 'json');
      const { parameter } = JSON.parse(value);
      // Expected parameters are different for node-test-pull-request and
      // node-test-commit-v8-linux, but we don't know which this FormData
      // is for, so we make a guess.
      const expectedParameters = parameter.some(({ name, _ }) => name === 'PR_ID')
        ? {
            CERTIFY_SAFE: 'on',
            COMMIT_SHA_CHECK: 'deadbeef',
            TARGET_GITHUB_ORG: owner,
            TARGET_REPO_NAME: repo,
            PR_ID: prid,
            REBASE_ONTO: '<pr base branch>',
            DESCRIPTION_SETTER_DESCRIPTION: ''
          }
        : {
            GITHUB_ORG: owner,
            REPO_NAME: repo,
            GIT_REMOTE_REF: `refs/pull/${prid}/head`,
            COMMIT_SHA_CHECK: 'deadbeef'
          };
      for (const { name, value } of parameter) {
        assert.strictEqual(value, expectedParameters[name]);
        delete expectedParameters[name];
      }
      assert.strictEqual(Object.keys(expectedParameters).length, 0);

      this._validated = true;

      return FormData.prototype.append.wrappedMethod.bind(this)(key, value);
    });
  });

  it('should fail if starting node-pull-request throws', async() => {
    const cli = new TestCLI();
    const request = {
      fetch: sinon.stub().returns(Promise.resolve({ status: 400 })),
      text: sinon.stub().throws(),
      json: sinon.stub().withArgs(CI_CRUMB_URL)
        .returns(Promise.resolve({ crumb }))
    };

    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, true);
    assert.strictEqual(await jobRunner.start(), false);
  });

  it('should return false if crumb fails', async() => {
    const cli = new TestCLI();
    const request = {
      json: sinon.stub().throws()
    };

    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, true);
    assert.strictEqual(await jobRunner.start(), false);
  });

  it('should start node-pull-request', async() => {
    const cli = new TestCLI();

    const request = {
      gql: sinon.stub().returns({
        repository: {
          pullRequest: {
            labels: {
              nodes: []
            }
          }
        }
      }),
      fetch: sinon.stub()
        .callsFake((url, { method, headers, body }) => {
          assert.strictEqual(url, CI_PR_URL);
          assert.strictEqual(method, 'POST');
          assert.deepStrictEqual(headers, { 'Jenkins-Crumb': crumb });
          assert.ok(body._validated);
          return Promise.resolve({ status: 201 });
        }),
      json: sinon.stub().withArgs(CI_CRUMB_URL)
        .returns(Promise.resolve({ crumb }))
    };
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef');
    assert.ok(await jobRunner.start());
  });

  it('should start node-test-commit-v8-linux', async() => {
    const cli = new TestCLI();

    const request = {
      gql: sinon.stub().returns({
        repository: {
          pullRequest: {
            labels: {
              nodes: [{ name: 'v8 engine' }]
            }
          }
        }
      }),
      fetch: sinon.stub()
        .callsFake((url, { method, headers, body }) => {
          assert.strictEqual(url, CI_PR_URL);
          assert.strictEqual(method, 'POST');
          assert.deepStrictEqual(headers, { 'Jenkins-Crumb': crumb });
          assert.ok(body._validated);
          return Promise.resolve({ status: 201 });
        }).onSecondCall().callsFake((url, { method, headers, body }) => {
          assert.strictEqual(url, CI_V8_URL);
          assert.strictEqual(method, 'POST');
          assert.deepStrictEqual(headers, { 'Jenkins-Crumb': crumb });
          assert.ok(body._validated);
          return Promise.resolve({ status: 201 });
        }),
      json: sinon.stub().withArgs(CI_CRUMB_URL)
        .returns(Promise.resolve({ crumb }))
    };
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef');
    assert.ok(await jobRunner.start());
  });

  it('should return false if node-pull-request not started', async() => {
    const cli = new TestCLI();

    const request = {
      fetch: sinon.stub()
        .callsFake((url, { method, headers, body }) => {
          assert.strictEqual(url, CI_PR_URL);
          assert.strictEqual(method, 'POST');
          assert.deepStrictEqual(headers, { 'Jenkins-Crumb': crumb });
          assert.ok(body._validated);
          return Promise.resolve({ status: 401 });
        }),
      json: sinon.stub().withArgs(CI_CRUMB_URL)
        .returns(Promise.resolve({ crumb }))
    };
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, true);
    assert.strictEqual(await jobRunner.start(), false);
  });

  describe('without --certify-safe flag', { concurrency: false }, () => {
    afterEach(() => {
      sinon.restore();
    });
    for (const certifySafe of [true, false]) {
      it(`should return ${certifySafe} if PR checker reports it as ${
        certifySafe ? '' : 'potentially un'
      }safe`, async() => {
        const cli = new TestCLI();

        sinon.replace(PRChecker.prototype, 'getApprovedTipOfHead',
          sinon.fake.returns(certifySafe && 'deadbeef'));

        const request = {
          gql: sinon.stub().returns({
            repository: {
              pullRequest: {
                labels: {
                  nodes: []
                }
              }
            }
          }),
          fetch: sinon.stub()
            .callsFake((url, { method, headers, body }) => {
              assert.strictEqual(url, CI_PR_URL);
              assert.strictEqual(method, 'POST');
              assert.deepStrictEqual(headers, { 'Jenkins-Crumb': crumb });
              assert.ok(body._validated);
              return Promise.resolve({ status: 201 });
            }),
          json: sinon.stub().withArgs(CI_CRUMB_URL)
            .returns(Promise.resolve({ crumb }))
        };

        const jobRunner = new RunPRJob(cli, request, owner, repo, prid, false);
        assert.strictEqual(await jobRunner.start(), certifySafe);
      });
    }
  });
});
