import assert from 'assert';

import sinon from 'sinon';
import FormData from 'form-data';

import {
  RunPRJob,
  CI_CRUMB_URL,
  CI_PR_NAME,
  CI_PR_RESUME_URL
} from '../../lib/ci/run_ci.js';

import { CI_DOMAIN } from '../../lib/ci/ci_type_parser.js';
import TestCLI from '../fixtures/test_cli.js';
import { jobCache } from '../../lib/ci/build-types/job.js';

describe('Jenkins resume', () => {
  const owner = 'nodejs';
  const repo = 'node-auto-test';
  const prid = 123456;
  const jobid = 654321;
  const crumb = 'asdf1234';

  before(() => {
    jobCache.disable();
    sinon.stub(FormData.prototype, 'append').callsFake(function(key, value) {
      assert.strictEqual(key, 'json');
      const { parameter } = JSON.parse(value);
      const expectedParameters = {
        CERTIFY_SAFE: 'on',
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

      return FormData.prototype.append.wrappedMethod.bind(this)(key, value);
    });
  });

  after(() => {
    sinon.restore();
  });

  it('should return false if crumb fails', async() => {
    const cli = new TestCLI();
    const request = {
      json: sinon.stub().throws()
    };

    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, jobid);
    assert.strictEqual(await jobRunner.resume(), false);
  });

  it('should return false if run status not FAILURE', async() => {
    const cli = new TestCLI();

    const request = {
      json: sinon.stub()
    };

    request.json.withArgs(CI_CRUMB_URL)
      .returns(Promise.resolve({ crumb }));
    request.json.withArgs(`https://${CI_DOMAIN}/job/${CI_PR_NAME}/${jobid}/api/json?tree=result%2Curl%2Cnumber`)
      .returns(Promise.resolve({ result: null }));
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, jobid);
    assert.strictEqual(await jobRunner.resume(), false);
  });

  it('should resume node-pull-request job', async() => {
    const cli = new TestCLI();

    const request = {
      fetch: sinon.stub()
        .callsFake((url, { method, headers }) => {
          assert.strictEqual(url, `${CI_PR_RESUME_URL}${jobid}/resume`);
          assert.strictEqual(method, 'POST');
          assert.deepStrictEqual(headers, { 'Jenkins-Crumb': crumb });
          return Promise.resolve({ status: 200 });
        }),
      json: sinon.stub()
    };

    request.json.withArgs(CI_CRUMB_URL)
      .returns(Promise.resolve({ crumb }));
    request.json.withArgs(`https://${CI_DOMAIN}/job/${CI_PR_NAME}/${jobid}/api/json?tree=result%2Curl%2Cnumber`)
      .returns(Promise.resolve({ result: 'FAILURE' }));
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, jobid);
    assert.ok(await jobRunner.resume());
  });

  it('should fail if resuming node-pull-request throws', async() => {
    const cli = new TestCLI();
    const request = {
      fetch: sinon.stub().throws(),
      json: sinon.stub()
    };

    request.json.withArgs(CI_CRUMB_URL)
      .returns(Promise.resolve({ crumb }));
    request.json.withArgs(`https://${CI_DOMAIN}/job/${CI_PR_NAME}/${jobid}/api/json?tree=result%2Curl%2Cnumber`)
      .returns(Promise.resolve({ result: 'FAILURE' }));

    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, jobid);
    assert.strictEqual(await jobRunner.resume(), false);
  });

  it('should return false if node-pull-request not resumed', async() => {
    const cli = new TestCLI();

    const request = {
      fetch: sinon.stub()
        .callsFake((url, { method, headers }) => {
          assert.strictEqual(url, `${CI_PR_RESUME_URL}${jobid}/resume`);
          assert.strictEqual(method, 'POST');
          assert.deepStrictEqual(headers, { 'Jenkins-Crumb': crumb });
          return Promise.resolve({ status: 401 });
        }),
      json: sinon.stub()
    };

    request.json.withArgs(CI_CRUMB_URL)
      .returns(Promise.resolve({ crumb }));
    request.json.withArgs(`https://${CI_DOMAIN}/job/${CI_PR_NAME}/${jobid}/api/json?tree=result%2Curl%2Cnumber`)
      .returns(Promise.resolve({ result: 'FAILURE' }));
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid, jobid);
    assert.strictEqual(await jobRunner.resume(), false);
  });
});
