import { describe, it, before, afterEach, beforeEach } from 'node:test';
import assert from 'assert';

import * as sinon from 'sinon';
import { FormData } from 'undici';

import {
  RunPRJob,
  CI_CRUMB_URL,
  CI_PR_URL,
  CI_V8_URL
} from '../../lib/ci/run_ci.js';
import PRChecker from '../../lib/pr_checker.js';

import TestCLI from '../fixtures/test_cli.js';
import { PRBuild } from '../../lib/ci/build-types/pr_build.js';
import { JobParser } from '../../lib/ci/ci_type_parser.js';
import PRData from '../../lib/pr_data.js';

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

  describe('--check-for-duplicates', { concurrency: false }, () => {
    beforeEach(() => {
      sinon.replace(PRData.prototype, 'getComments', sinon.fake.resolves());
      sinon.replace(PRData.prototype, 'getPR', sinon.fake.resolves());
      sinon.replace(JobParser.prototype, 'parse',
        sinon.fake.returns(new Map().set('PR', { jobid: 123456 })));
    });
    afterEach(() => {
      sinon.restore();
    });

    const getParameters = (commitHash) =>
      [
        {
          _class: 'hudson.model.BooleanParameterValue',
          name: 'CERTIFY_SAFE',
          value: true
        },
        {
          _class: 'hudson.model.StringParameterValue',
          name: 'COMMIT_SHA_CHECK',
          value: commitHash
        },
        {
          _class: 'hudson.model.StringParameterValue',
          name: 'TARGET_GITHUB_ORG',
          value: 'nodejs'
        },
        {
          _class: 'hudson.model.StringParameterValue',
          name: 'TARGET_REPO_NAME',
          value: 'node'
        },
        {
          _class: 'hudson.model.StringParameterValue',
          name: 'PR_ID',
          value: prid
        },
        {
          _class: 'hudson.model.StringParameterValue',
          name: 'REBASE_ONTO',
          value: '<pr base branch>'
        },
        {
          _class: 'com.wangyin.parameter.WHideParameterValue',
          name: 'DESCRIPTION_SETTER_DESCRIPTION',
          value: ''
        }
      ];
    const mockJenkinsResponse = parameters => ({
      _class: 'com.tikal.jenkins.plugins.multijob.MultiJobBuild',
      actions: [
        { _class: 'hudson.model.CauseAction' },
        { _class: 'hudson.model.ParametersAction', parameters },
        { _class: 'hudson.model.ParametersAction', parameters },
        { _class: 'hudson.model.ParametersAction', parameters },
        {},
        { _class: 'hudson.model.CauseAction' },
        {},
        {},
        {},
        {},
        { _class: 'hudson.plugins.git.util.BuildData' },
        {},
        {},
        {},
        {},
        { _class: 'hudson.model.ParametersAction', parameters },
        {
          _class: 'hudson.plugins.parameterizedtrigger.BuildInfoExporterAction'
        },
        {
          _class: 'com.tikal.jenkins.plugins.multijob.MultiJobTestResults'
        },
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {
          _class: 'org.jenkinsci.plugins.displayurlapi.actions.RunDisplayAction'
        }
      ]
    });

    it('should return false if already started', async() => {
      const cli = new TestCLI();
      sinon.replace(PRBuild.prototype, 'getBuildData',
        sinon.fake.resolves(mockJenkinsResponse(getParameters('deadbeef'))));

      const jobRunner = new RunPRJob(cli, {}, owner, repo, prid, 'deadbeef', true);
      assert.strictEqual(await jobRunner.start(), false);
    });
    it('should return true when last CI is on a different commit', async() => {
      const cli = new TestCLI();
      sinon.replace(PRBuild.prototype, 'getBuildData',
        sinon.fake.resolves(mockJenkinsResponse(getParameters('123456789abcdef'))));

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
            return Promise.resolve({ status: 201 });
          }),
        json: sinon.stub().withArgs(CI_CRUMB_URL).resolves({ crumb })
      };
      const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef', true);
      assert.strictEqual(await jobRunner.start(), true);
    });
  });
});
