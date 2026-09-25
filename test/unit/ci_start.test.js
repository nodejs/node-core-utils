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
    const jobid = 123456;
    const jobURL = `https://ci.nodejs.org/job/node-test-pull-request/${jobid}/`;
    const menuURL = `${jobURL}contextMenu`;
    const duplicateRefusal = 'Refusing to start a potentially duplicate CI job. ';
    const resumeHint = `Resume CI with: ncu-ci resume https://github.com/${owner}/${repo}/pull/${prid}`;
    const manualHint = 'Check the existing CI run in Jenkins and rebase the PR if needed. ' +
      `To start a new CI run manually: ncu-ci run https://github.com/${owner}/${repo}/pull/${prid}`;
    beforeEach(() => {
      sinon.replace(PRData.prototype, 'getComments', sinon.fake.resolves());
      sinon.replace(PRData.prototype, 'getPR', sinon.fake.resolves());
      sinon.replace(JobParser.prototype, 'parse',
        sinon.fake.returns(new Map().set('PR', { jobid, link: jobURL })));
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
          value: owner
        },
        {
          _class: 'hudson.model.StringParameterValue',
          name: 'TARGET_REPO_NAME',
          value: repo
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
    const createRequest = () => {
      const request = {
        fetch: sinon.stub().rejects(new Error('Unexpected fetch request')),
        json: sinon.stub().rejects(new Error('Unexpected JSON request'))
      };
      request.json.withArgs(CI_CRUMB_URL).resolves({ crumb });
      request.fetch.withArgs(CI_PR_URL).resolves({ status: 201 });
      return request;
    };

    it('should return false if inferred commit already has CI', async() => {
      const cli = new TestCLI();
      sinon.replace(PRData.prototype, 'getReviews', sinon.fake.resolves());
      sinon.replace(PRData.prototype, 'getCommits', sinon.fake.resolves());
      sinon.replace(PRChecker.prototype, 'getApprovedTipOfHead',
        sinon.fake.returns('deadbeef'));
      sinon.replace(PRBuild.prototype, 'getBuildData',
        sinon.fake.resolves(mockJenkinsResponse(getParameters('deadbeef'))));

      const request = {
        fetch: sinon.stub().resolves({ status: 201 }),
        json: sinon.stub().withArgs(CI_CRUMB_URL).resolves({ crumb })
      };
      const jobRunner = new RunPRJob(cli, request, owner, repo, prid, undefined, true);
      assert.strictEqual(await jobRunner.start(), false);
      assert.strictEqual(request.fetch.callCount, 0);
    });
    const inProgress = 'The existing CI run is still in progress.';
    const succeeded = 'CI has already succeeded for this commit.';
    const checkJenkins = 'Check the existing CI run in Jenkins before retrying.';
    for (const [state, reason] of [
      [{ building: true, result: null }, inProgress],
      [{ building: true, result: 'FAILURE' }, inProgress],
      [{ building: false, result: null }, checkJenkins],
      [{ building: false, result: 'SUCCESS' }, succeeded],
      [{ building: false, result: 'UNSTABLE' }, checkJenkins],
      [{ building: false, result: 'NOT_BUILT' }, checkJenkins],
      [{ building: false, result: 'UNKNOWN' }, checkJenkins],
      [{ building: false }, checkJenkins],
      [{ result: 'FAILURE' }, checkJenkins]
    ]) {
      it(`should reject duplicate CI without a resume lookup for ${
        JSON.stringify(state)}`, async() => {
        const cli = new TestCLI();
        sinon.replace(PRBuild.prototype, 'getBuildData', sinon.fake.resolves({
          ...mockJenkinsResponse(getParameters('deadbeef')),
          ...state
        }));
        const request = createRequest();
        const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef', true);
        assert.strictEqual(await jobRunner.start(), false);
        sinon.assert.notCalled(request.fetch);
        assert.deepStrictEqual(cli._calls.error, [[duplicateRefusal + reason]]);
      });
    }
    for (const result of ['FAILURE', 'ABORTED']) {
      for (const resumable of [true, false]) {
        it(`should reject duplicate CI for a ${
          result} job ${resumable ? 'with' : 'without'} a resume action`, async() => {
          const cli = new TestCLI();
          sinon.replace(PRBuild.prototype, 'getBuildData', sinon.fake.resolves({
            ...mockJenkinsResponse(getParameters('deadbeef')),
            result,
            building: false
          }));
          const request = createRequest();
          const menuRequest = request.fetch.withArgs(menuURL).resolves({
            status: 200,
            json: async() => ({ items: resumable ? [{ url: 'resume' }] : [] })
          });
          const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef', true);
          assert.strictEqual(await jobRunner.start(), false);
          sinon.assert.calledOnceWithExactly(menuRequest, menuURL, {
            method: 'GET', redirect: 'error'
          });
          sinon.assert.notCalled(request.fetch.withArgs(CI_PR_URL));
          assert.deepStrictEqual(cli._calls.error,
            [[duplicateRefusal + (resumable ? resumeHint : manualHint)]]);
        });
      }
    }
    it('should suggest the resume-ci label for a resumable nodejs/node build', async() => {
      const cli = new TestCLI();
      const parameters = getParameters('deadbeef').map(parameter =>
        parameter.name === 'TARGET_REPO_NAME' ? { ...parameter, value: 'node' } : parameter);
      sinon.replace(PRBuild.prototype, 'getBuildData', sinon.fake.resolves({
        ...mockJenkinsResponse(parameters),
        result: 'FAILURE',
        building: false
      }));
      const request = createRequest();
      request.fetch.withArgs(menuURL).resolves({
        status: 200,
        json: async() => ({ items: [{ url: 'resume' }] })
      });
      const jobRunner = new RunPRJob(cli, request, owner, 'node', prid, 'deadbeef', true);
      assert.strictEqual(await jobRunner.start(), false);
      sinon.assert.notCalled(request.fetch.withArgs(CI_PR_URL));
      assert.deepStrictEqual(cli._calls.error, [[duplicateRefusal +
        'Resume CI by adding the "resume-ci" label to the PR, or run: ' +
        `ncu-ci resume https://github.com/nodejs/node/pull/${prid}`]]);
    });
    for (const resumable of [true, false]) {
      it(`should reject duplicate CI when the resume ancestor ${
        resumable ? 'has' : 'does not have'} a resume action`, async() => {
        const cli = new TestCLI();
        const ancestorJobid = jobid - 1;
        const ancestorURL = `https://ci.nodejs.org/job/node-test-pull-request/${ancestorJobid}/`;
        const data = {
          ...mockJenkinsResponse(getParameters('deadbeef')),
          result: 'FAILURE',
          building: false
        };
        const latestData = {
          ...data,
          actions: [...data.actions, {
            causes: [{
              _class: 'com.tikal.jenkins.plugins.multijob.ResumeCause',
              upstreamProject: 'node-test-pull-request',
              upstreamBuild: ancestorJobid,
              upstreamUrl: 'job/node-test-pull-request/'
            }]
          }]
        };
        const getBuildData = sinon.stub(PRBuild.prototype, 'getBuildData');
        getBuildData.onFirstCall().resolves(latestData);
        getBuildData.onSecondCall().resolves(data);
        const request = createRequest();
        request.fetch.withArgs(menuURL).resolves({
          status: 200,
          json: async() => ({ items: [] })
        });
        const ancestorMenu = request.fetch.withArgs(`${ancestorURL}contextMenu`).resolves({
          status: 200,
          json: async() => ({ items: resumable ? [{ url: 'resume' }] : [] })
        });
        const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef', true);
        assert.strictEqual(await jobRunner.start(), false);
        sinon.assert.calledTwice(getBuildData);
        assert.strictEqual(getBuildData.secondCall.thisValue.jobUrl, ancestorURL);
        sinon.assert.calledOnce(ancestorMenu);
        sinon.assert.notCalled(request.fetch.withArgs(CI_PR_URL));
        assert.deepStrictEqual(cli._calls.error,
          [[duplicateRefusal + (resumable ? resumeHint : manualHint)]]);
      });
    }
    it('should reject duplicate CI when an ancestor cannot be queried', async() => {
      const cli = new TestCLI();
      const data = {
        ...mockJenkinsResponse(getParameters('deadbeef')),
        result: 'FAILURE',
        building: false
      };
      data.actions.push({
        causes: [{
          _class: 'com.tikal.jenkins.plugins.multijob.ResumeCause',
          upstreamProject: 'node-test-pull-request',
          upstreamBuild: jobid - 1,
          upstreamUrl: 'job/node-test-pull-request/'
        }]
      });
      const getBuildData = sinon.stub(PRBuild.prototype, 'getBuildData');
      getBuildData.onFirstCall().resolves(data);
      getBuildData.onSecondCall().rejects(new Error('Ancestor metadata unavailable'));
      const request = createRequest();
      request.fetch.withArgs(menuURL).resolves({
        status: 200,
        json: async() => ({ items: [] })
      });
      const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef', true);
      assert.strictEqual(await jobRunner.start(), false);
      sinon.assert.notCalled(request.fetch.withArgs(CI_PR_URL));
      assert.match(cli._calls.error[0][0], /Ancestor metadata unavailable/);
    });
    it('should reject a potential duplicate CI with conflicting approved commits', async() => {
      const cli = new TestCLI();
      const data = {
        ...mockJenkinsResponse(getParameters('different-commit')),
        result: 'FAILURE',
        building: false
      };
      data.actions.push({ parameters: getParameters('deadbeef') });
      sinon.replace(PRBuild.prototype, 'getBuildData', sinon.fake.resolves(data));
      const request = createRequest();
      const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef', true);
      assert.strictEqual(await jobRunner.start(), false);
      sinon.assert.notCalled(request.fetch);
      assert.deepStrictEqual(cli._calls.error, [[duplicateRefusal + checkJenkins]]);
    });
    it('should reject duplicate CI when resume availability cannot be checked', async() => {
      const cli = new TestCLI();
      sinon.replace(PRBuild.prototype, 'getBuildData', sinon.fake.resolves({
        ...mockJenkinsResponse(getParameters('deadbeef')),
        result: 'FAILURE',
        building: false
      }));
      const request = createRequest();
      request.fetch.withArgs(menuURL).resolves({ status: 403, statusText: 'Forbidden' });
      const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef', true);
      assert.strictEqual(await jobRunner.start(), false);
      sinon.assert.notCalled(request.fetch.withArgs(CI_PR_URL));
      assert.match(cli._calls.error[0][0], /Could not check whether existing CI run/);
      assert.ok(cli._calls.error[0][0].includes(jobURL));
      assert.match(cli._calls.error[0][0], /403 Forbidden/);
      assert.match(cli._calls.error[1][0], /Retry after checking Jenkins access/);
    });
    it('should not look up existing builds without the duplicate check flag', async() => {
      const cli = new TestCLI();
      const getBuildData = sinon.fake.rejects(new Error('Unexpected metadata lookup'));
      sinon.replace(PRBuild.prototype, 'getBuildData', getBuildData);
      const request = createRequest();
      const jobRunner = new RunPRJob(cli, request, owner, repo, prid, 'deadbeef');
      assert.strictEqual(await jobRunner.start(), true);
      sinon.assert.notCalled(PRData.prototype.getComments);
      sinon.assert.notCalled(getBuildData);
      sinon.assert.calledOnceWithMatch(request.fetch, CI_PR_URL, { method: 'POST' });
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
    it('should start CI when the existing CI run cannot be queried', async() => {
      const cli = new TestCLI();
      const err = new SyntaxError('Unexpected token \'<\', "<!DOCTYPE " is not valid JSON');
      sinon.replace(PRBuild.prototype, 'getBuildData', sinon.fake.rejects(err));

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
      assert.strictEqual(request.fetch.callCount, 1);
    });
  });
});
