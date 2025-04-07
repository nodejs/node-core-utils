/* eslint-disable import/no-named-as-default-member */
import { describe, it, before, afterEach } from 'node:test';
import assert from 'assert';

import sinon from 'sinon';
import { FormData } from 'undici';

import {
  RunPRJob,
  CI_CRUMB_URL,
  CI_PR_URL
} from '../../lib/ci/run_ci.js';
import PRChecker from '../../lib/pr_checker.js';
import PRData from '../../lib/pr_data.js';

import TestCLI from '../fixtures/test_cli.js';

describe('Jenkins', () => {
  const owner = 'nodejs';
  const repo = 'node-auto-test';
  const prid = 123456;
  const crumb = 'asdf1234';
  const dummySHA = '51ce389dc1d539216d30bba0986a8c270801d65f';

  before(() => {
    const stubbed = sinon.stub(FormData.prototype, 'append').callsFake(function(key, value) {
      assert.strictEqual(key, 'json');
      const { parameter } = JSON.parse(value);
      const expectedParameters = {
        CERTIFY_SAFE: 'on',
        COMMIT_SHA_CHECK: dummySHA,
        TARGET_GITHUB_ORG: owner,
        TARGET_REPO_NAME: repo,
        PR_ID: prid,
        REBASE_ONTO: '<pr base branch>',
        DESCRIPTION_SETTER_DESCRIPTION: ''
      };
      for (const { name, value } of parameter) {
        assert.strictEqual(value, expectedParameters[name]);
        delete expectedParameters[name];
      }
      assert.strictEqual(Object.keys(expectedParameters).length, 0);

      this._validated = true;

      return Reflect.apply(FormData.prototype.append.wrappedMethod, this, arguments);
    });

    return () => stubbed.restore();
  });

  it('should fail if starting node-pull-request throws', async() => {
    const cli = new TestCLI();
    const request = {
      fetch: sinon.stub().returns(Promise.resolve({ status: 400 })),
      text: sinon.stub().throws(),
      json: sinon.stub().withArgs(CI_CRUMB_URL)
        .returns(Promise.resolve({ crumb }))
    };

    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, dummySHA);
    assert.strictEqual(await jobRunner.start(), false);
  });

  it('should return false if crumb fails', async() => {
    const cli = new TestCLI();
    const request = {
      json: sinon.stub().throws()
    };

    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, dummySHA);
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
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, dummySHA);
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
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, dummySHA);
    assert.strictEqual(await jobRunner.start(), false);
  });

  describe('without --certify-safe flag', { concurrency: false }, () => {
    before(() => {
      sinon.replace(PRData.prototype, 'getReviews', function() {});
      sinon.replace(PRData.prototype, 'getCommits', function() {});
      return () => {
        PRData.prototype.getReviews.restore();
        PRData.prototype.getCommits.restore();
      };
    });
    afterEach(() => {
      PRData.prototype.getCollaborators.restore();
      PRData.prototype.getComments.restore();
      PRChecker.prototype.getApprovedTipOfHead.restore();
    });

    for (const { headIsApproved = false, collaborators = [], comments = [], expected } of [{
      headIsApproved: true,
      expected: true,
    }, {
      headIsApproved: false,
      expected: false,
    }, {
      collaborators: ['foo'],
      comments: [{ login: 'foo' }],
      expected: true,
    }, {
      // Validates that passing full commit URL also works.
      collaborators: ['foo'],
      comments: [{ login: 'foo', body: `@nodejs-github-bot test https://github.com/nodejs/node/commit/${dummySHA}.\n` }],
      expected: true,
    }, {
      // Validates that non-collaborator commenting should have no effect.
      collaborators: ['foo'],
      comments: [{ login: 'bar' }],
      expected: false,
    }]) {
      it(`should return ${expected} with ${
        JSON.stringify({ headIsApproved, collaborators, comments })}`, async() => {
        const cli = new TestCLI();

        sinon.stub(PRData.prototype, 'getCollaborators').callsFake(function() {
          this.collaborators = collaborators.map(login => ({ login }));
        });
        sinon.stub(PRData.prototype, 'getComments').callsFake(function() {
          this.comments = comments.map(({ body, login }) => ({
            body: body ?? `@nodejs-github-bot test ${dummySHA}`,
            author: { login }
          }));
        });
        sinon.stub(PRChecker.prototype, 'getApprovedTipOfHead').callsFake(
          sinon.fake.returns(headIsApproved && dummySHA));

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
        assert.strictEqual(await jobRunner.start(), expected);
      });
    }
  });
});
