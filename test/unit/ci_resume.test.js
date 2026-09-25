import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sinon from 'sinon';
import { fetch, MockAgent } from 'undici';

import { ResumePRJob } from '../../lib/ci/resume_ci.js';
import { CI_CRUMB_URL } from '../../lib/ci/run_ci.js';
import TestCLI from '../fixtures/test_cli.js';
import Request from '../../lib/request.js';
import { PRBuild } from '../../lib/ci/build-types/pr_build.js';

const approvedSHA = 'a'.repeat(40);
const resumeTree = 'result,building,actions[parameters[name,value],' +
  'causes[_class,upstreamProject,upstreamBuild,upstreamUrl]]';
function getResumeBuildData(owner, repo, prid) {
  return {
    result: 'FAILURE',
    building: false,
    actions: [
      // Jenkins does not export MultiJobResumeBuild, so the action serializes as {}.
      {},
      {
        parameters: [
          { name: 'COMMIT_SHA_CHECK', value: approvedSHA },
          { name: 'TARGET_GITHUB_ORG', value: owner },
          { name: 'TARGET_REPO_NAME', value: repo },
          { name: 'PR_ID', value: String(prid) }
        ]
      }
    ]
  };
}
const resumeBuildData = getResumeBuildData('nodejs', 'node', 123456);
const failureLog = 'not ok 1 parallel/test-example\n' +
  '  ---\n  severity: fail\n  stack: |-\n    AssertionError\n  ...\n';
const failureBuildData = {
  result: 'FAILURE',
  actions: [{ parameters: [] }],
  changeSet: { items: [] },
  subBuilds: [{
    buildNumber: 1,
    build: {
      subBuilds: [{
        jobName: 'node-test-commit-linux-freestyle',
        result: 'FAILURE',
        url: 'https://ci.nodejs.org/job/node-test-commit-linux-freestyle/1/'
      }]
    }
  }]
};

// Diagnostic excerpts captured with ncu-ci walk pr on 2026-09-09.
const walkFailures = JSON.parse(readFileSync(
  new URL('../fixtures/ci-resume-walk.json', import.meta.url), 'utf8'));
const reliabilityFailures = JSON.parse(readFileSync(
  new URL('../fixtures/ci-reliability-failures.json', import.meta.url), 'utf8'));

describe('Resume file checks against real CI diagnostics', () => {
  for (const { name, kind, filenames, log, url } of reliabilityFailures) {
    if (kind !== 'failure') continue;
    it(`prints the diagnostic and console URL for ${name}`, async() => {
      const data = structuredClone(failureBuildData);
      const buildURL = url.replace(/console(?:Text)?$/, '');
      data.subBuilds[0].build.subBuilds[0].url = buildURL;
      const request = {
        async json() { return data; },
        async * stream(url) {
          assert.equal(url, `${buildURL}consoleText`);
          yield Buffer.from(`${log}\n`);
        },
        async * getPullRequestFiles() {
          for (const filename of filenames) yield { filename };
        }
      };
      const cli = new TestCLI();
      const runner = new ResumePRJob(cli, request, 'nodejs', 'node', 1);
      assert.equal(await runner.checkFailures(1), false);
      assert.deepEqual(cli._calls.error, [[filenames[0]]]);
      assert.deepEqual(cli._calls.info, [[`${buildURL}consoleText`]]);
      assert.deepEqual(cli._calls.log, [[log]]);
    });
  }

  for (const { filename, failure } of walkFailures) {
    it(`detects a PR change to ${filename}`, async() => {
      const request = {
        async json() { return failureBuildData; },
        async * stream() { yield Buffer.from(`${failure.reason}\n  ...\n`); },
        async * getPullRequestFiles() { yield { filename }; }
      };
      const cli = new TestCLI();
      const runner = new ResumePRJob(cli, request, 'nodejs', 'node', 1);
      assert.equal(await runner.checkFailures(1), false);
      assert.deepEqual(cli._calls.error, [[filename]]);

      request.getPullRequestFiles = async function * () {
        yield { filename: `${filename}.unrelated` };
      };
      assert.equal(await runner.checkFailures(1), true);
    });
  }
});

describe('Jenkins resume', () => {
  const owner = 'nodejs';
  const repo = 'node-auto-test';
  const prid = 123456;
  const resumeBuildData = getResumeBuildData(owner, repo, prid);
  const jobid = 654321;
  const crumb = 'asdf1234';
  const jobURL = `https://ci.nodejs.org/job/node-test-pull-request/${jobid}/`;
  const menuURL = `${jobURL}contextMenu`;
  const unavailableMessage = `Cannot resume PR CI job ${jobid}: Jenkins does not offer a ` +
    '"Resume build" action. Check the existing CI run in Jenkins and rebase the PR if needed. ' +
    'To start a new CI run manually: ' +
    `ncu-ci run https://github.com/${owner}/${repo}/pull/${prid}`;
  const apiURL = `${jobURL}api/json?tree=${encodeURIComponent(resumeTree)}`;
  const fullAPIURL = new PRBuild(null, null, jobid).apiUrl;
  const filesURL = `/repos/${owner}/${repo}/pulls/${prid}/files?per_page=100&page=1`;
  const prURL = `/repos/${owner}/${repo}/pulls/${prid}`;
  const comment = (bodyText, publishedAt = '2026-09-09T12:00:00Z') =>
    ({ bodyText, publishedAt });
  let cli;
  let request;
  let jobRunner;
  let menuRequest;
  let resumeRequest;

  beforeEach(() => {
    cli = new TestCLI();
    request = {
      json: sinon.stub().rejects(new Error('Unexpected JSON request')),
      gql: sinon.stub().rejects(new Error('Unexpected GraphQL request')),
      text: sinon.stub().resolves(failureLog),
      async * stream(url) { yield Buffer.from(await request.text(url)); },
      getPullRequestFiles: Request.prototype.getPullRequestFiles,
      getPullRequest: Request.prototype.getPullRequest,
      fetch: sinon.stub().rejects(new Error('Unexpected fetch request'))
    };
    menuRequest = request.fetch.withArgs(menuURL).resolves({
      status: 200,
      json: async() => ({ items: [{ url: new URL(`${jobURL}resume`).pathname }] })
    });
    resumeRequest = request.fetch.withArgs(`${jobURL}resume/`).resolves({ status: 200 });
    request.json.withArgs(CI_CRUMB_URL).resolves({ crumb });
    request.json.withArgs(apiURL).resolves(resumeBuildData);
    request.json.withArgs(prURL).resolves({ head: { sha: approvedSHA } });
    request.json.withArgs(fullAPIURL).resolves(failureBuildData);
    request.json.withArgs(filesURL).resolves([{ filename: 'README.md' }]);
    request.gql.withArgs('PR').resolves({
      repository: {
        pullRequest: { bodyText: '', createdAt: '2026-09-08T12:00:00Z' }
      }
    });
    request.gql.withArgs('Reviews').resolves([]);
    request.gql.withArgs('PRComments').resolves([comment(jobURL)]);
    jobRunner = new ResumePRJob(cli, request, owner, repo, prid);
  });

  it('resumes the PR job with a Jenkins crumb and an unexported resume action', async() => {
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnceWithExactly(menuRequest, menuURL, {
      method: 'GET', redirect: 'error'
    });
    sinon.assert.calledOnceWithExactly(resumeRequest, `${jobURL}resume/`, {
      method: 'POST',
      headers: { 'Jenkins-Crumb': crumb }
    });
    assert.equal(request.gql.callCount, 3);
    for (const call of request.gql.getCalls()) {
      assert.deepEqual(call.args[1], { owner, repo, prid });
    }
    assert.deepEqual(cli._calls.stopSpinner.at(-1), ['PR CI job successfully resumed']);
  });

  for (const result of ['FAILURE', 'ABORTED']) {
    it(`does not scan failures or POST when a ${result} job has no resume action`, async() => {
      request.json.withArgs(apiURL).resolves({ ...resumeBuildData, result });
      menuRequest.resolves({ status: 200, json: async() => ({ items: [] }) });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(resumeRequest);
      sinon.assert.neverCalledWith(request.json, filesURL);
      sinon.assert.neverCalledWith(request.json, fullAPIURL);
      sinon.assert.neverCalledWith(request.json, prURL);
      sinon.assert.notCalled(request.text);
      assert.deepEqual(cli._calls.stopSpinner.at(-1), [
        unavailableMessage, cli.SPINNER_STATUS.FAILED
      ]);
      assert.doesNotMatch(cli._calls.stopSpinner.at(-1)[0], /request-ci|resume-ci/);
      assert.deepEqual(cli._calls.error, [[jobURL]]);
    });
  }

  it('suggests manual recovery for an unavailable nodejs/node run', async() => {
    jobRunner = new ResumePRJob(cli, request, 'nodejs', 'node', prid);
    request.json.withArgs(apiURL).resolves(getResumeBuildData('nodejs', 'node', prid));
    menuRequest.resolves({ status: 200, json: async() => ({ items: [] }) });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Cannot resume PR CI job ${jobid}: Jenkins does not offer a "Resume build" action. ` +
        'Check the existing CI run in Jenkins and rebase the PR if needed. ' +
        'To start a new CI run manually: ' +
        `ncu-ci run https://github.com/nodejs/node/pull/${prid}`,
      cli.SPINNER_STATUS.FAILED
    ]);
    assert.doesNotMatch(cli._calls.stopSpinner.at(-1)[0], /request-ci|resume-ci/);
  });

  for (const [name, value] of [
    ['TARGET_GITHUB_ORG', 'another-owner'], ['TARGET_GITHUB_ORG', undefined],
    ['TARGET_REPO_NAME', 'another-repo'], ['TARGET_REPO_NAME', undefined],
    ['PR_ID', String(prid + 1)], ['PR_ID', undefined]
  ]) {
    it(`rejects an initial build with mismatched ${name}: ${value}`, async() => {
      const data = structuredClone(resumeBuildData);
      data.actions[1].parameters.find(parameter => parameter.name === name).value = value;
      request.json.withArgs(apiURL).resolves(data);
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(request.fetch);
      sinon.assert.neverCalledWith(request.json, filesURL);
      assert.match(cli._calls.stopSpinner.at(-1)[0],
        /CI job 654321 does not match pull request nodejs\/node-auto-test#123456/);
    });
  }

  it('rejects conflicting identity parameters on the initial build', async() => {
    const data = structuredClone(resumeBuildData);
    data.actions.push({ parameters: [{ name: 'PR_ID', value: String(prid + 1) }] });
    request.json.withArgs(apiURL).resolves(data);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('accepts an initial build whose PR_ID parameter is a number', async() => {
    const data = structuredClone(resumeBuildData);
    data.actions[1].parameters.find(parameter => parameter.name === 'PR_ID').value = prid;
    request.json.withArgs(apiURL).resolves(data);
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(resumeRequest);
  });

  it('matches the initial build owner and repository case-insensitively', async() => {
    const data = getResumeBuildData(owner.toUpperCase(), repo.toUpperCase(), prid);
    request.json.withArgs(apiURL).resolves(data);
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(resumeRequest);
  });

  describe('resume ancestry', () => {
    const ancestorId = jobid - 1;
    const resumeCause = (id, overrides = {}) => ({
      _class: 'com.tikal.jenkins.plugins.multijob.ResumeCause',
      upstreamProject: 'node-test-pull-request',
      upstreamBuild: id,
      upstreamUrl: 'job/node-test-pull-request/',
      ...overrides
    });

    function latestWithoutAction(causes) {
      request.json.withArgs(apiURL).resolves({
        ...resumeBuildData,
        actions: [...resumeBuildData.actions, { causes }]
      });
      menuRequest.resolves({ status: 200, json: async() => ({ items: [] }) });
    }

    function ancestor(id = ancestorId, { resumable = true, causes = [], overrides = {} } = {}) {
      const build = new PRBuild(cli, request, id, undefined, resumeTree);
      const data = {
        ...resumeBuildData,
        actions: [{
          parameters: Object.entries({
            COMMIT_SHA_CHECK: approvedSHA,
            TARGET_GITHUB_ORG: owner,
            TARGET_REPO_NAME: repo,
            PR_ID: String(prid),
            ...overrides
          }).map(([name, value]) => ({ name, value }))
        }, { causes }]
      };
      request.json.withArgs(build.apiUrl).resolves(data);
      const menu = request.fetch.withArgs(`${build.jobUrl}contextMenu`).resolves({
        status: 200,
        json: async() => ({ items: resumable ? [{ url: `${build.jobUrl}resume/` }] : [] })
      });
      const post = request.fetch.withArgs(`${build.jobUrl}resume/`).resolves({ status: 200 });
      const failures = structuredClone(failureBuildData);
      failures.subBuilds[0].buildNumber = id;
      failures.subBuilds[0].build.subBuilds[0].url =
        `https://ci.nodejs.org/job/node-test-commit-linux-freestyle/${id}/`;
      request.json.withArgs(new PRBuild(null, null, id).apiUrl).resolves(failures);
      const consoleURL = `${failures.subBuilds[0].build.subBuilds[0].url}consoleText`;
      request.text.withArgs(consoleURL)
        .resolves(failureLog.replace('test-example', 'test-ancestor'));
      return { build, data, menu, post, consoleURL };
    }

    it('resumes the nearest ancestor and checks both its failures and the latest run', async() => {
      latestWithoutAction([resumeCause(ancestorId - 10), resumeCause(ancestorId)]);
      const { build, post, consoleURL } = ancestor();
      assert.equal(await jobRunner.resume(), true);
      sinon.assert.notCalled(resumeRequest);
      sinon.assert.calledOnceWithExactly(post, `${build.jobUrl}resume/`, {
        method: 'POST', headers: { 'Jenkins-Crumb': crumb }
      });
      sinon.assert.calledWithExactly(request.text,
        'https://ci.nodejs.org/job/node-test-commit-linux-freestyle/1/consoleText');
      sinon.assert.calledWithExactly(request.text, consoleURL);
      assert.deepEqual(cli._calls.info, [
        [`Using resumable ancestor PR CI job ${ancestorId} for latest job ${jobid}`]
      ]);
    });

    it('ignores malformed causes while following a valid resume cause', async() => {
      latestWithoutAction([null, {}, resumeCause(ancestorId)]);
      const { post } = ancestor();
      assert.equal(await jobRunner.resume(), true);
      sinon.assert.calledOnce(post);
    });

    it('follows multiple resume links until an ancestor offers the action', async() => {
      latestWithoutAction([resumeCause(ancestorId)]);
      const intermediate = ancestor(ancestorId, {
        resumable: false, causes: [resumeCause(ancestorId - 1)]
      });
      const earlier = ancestor(ancestorId - 1);
      assert.equal(await jobRunner.resume(), true);
      sinon.assert.calledOnce(earlier.post);
      sinon.assert.notCalled(intermediate.post);
      sinon.assert.notCalled(resumeRequest);
      sinon.assert.calledWithExactly(request.text, intermediate.consoleURL);
      sinon.assert.calledWithExactly(request.text, earlier.consoleURL);
    });

    for (const filename of ['test/parallel/test-example.js', 'test/parallel/test-ancestor.js']) {
      it(`refuses ancestor recovery when failures reference changed file ${filename}`, async() => {
        latestWithoutAction([resumeCause(ancestorId)]);
        const { post } = ancestor();
        request.json.withArgs(filesURL).resolves([{ filename }]);
        assert.equal(await jobRunner.resume(), false);
        sinon.assert.notCalled(post);
        sinon.assert.notCalled(resumeRequest);
        assert.deepEqual(cli._calls.error, [[filename]]);
        assert.deepEqual(cli._calls.stopSpinner.at(-1), [
          'Refusing to resume CI: failures reference files changed by this PR',
          cli.SPINNER_STATUS.FAILED
        ]);
      });
    }

    for (const overrides of [
      { COMMIT_SHA_CHECK: 'b'.repeat(40) },
      { COMMIT_SHA_CHECK: undefined },
      { TARGET_GITHUB_ORG: 'another-owner' },
      { TARGET_REPO_NAME: 'another-repo' },
      { PR_ID: prid + 1 },
      { PR_ID: undefined }
    ]) {
      it(`stops at an ancestor with mismatched identity: ${JSON.stringify(overrides)}`, async() => {
        latestWithoutAction([resumeCause(ancestorId), resumeCause(ancestorId - 1)]);
        const candidate = ancestor(ancestorId, {
          overrides, causes: [resumeCause(ancestorId - 1)]
        });
        const older = ancestor(ancestorId - 1);
        assert.equal(await jobRunner.resume(), false);
        sinon.assert.notCalled(candidate.menu);
        sinon.assert.notCalled(candidate.post);
        sinon.assert.notCalled(older.menu);
        sinon.assert.notCalled(older.post);
        sinon.assert.neverCalledWith(request.json, older.build.apiUrl);
      });
    }

    it('accepts an ancestor whose PR_ID parameter is a number', async() => {
      latestWithoutAction([resumeCause(ancestorId)]);
      const { post } = ancestor(ancestorId, { overrides: { PR_ID: prid } });
      assert.equal(await jobRunner.resume(), true);
      sinon.assert.calledOnce(post);
    });

    it('rejects conflicting identity parameters on an ancestor', async() => {
      latestWithoutAction([resumeCause(ancestorId)]);
      const { data, menu, post } = ancestor();
      data.actions.push({ parameters: [{ name: 'PR_ID', value: String(prid + 1) }] });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(menu);
      sinon.assert.notCalled(post);
    });

    for (const cause of [
      null, {}, resumeCause('654320'), resumeCause(-1), resumeCause(1.5),
      resumeCause(jobid), resumeCause(jobid + 1),
      resumeCause(ancestorId, { _class: 'hudson.model.Cause$UpstreamCause' }),
      resumeCause(ancestorId, { upstreamProject: 'node-test-commit' }),
      resumeCause(ancestorId, { upstreamUrl: 'job/node-test-commit/' }),
      resumeCause(ancestorId, { upstreamUrl: 'https://example.org/job/node-test-pull-request/' })
    ]) {
      it(`does not follow an invalid resume cause: ${JSON.stringify(cause)}`, async() => {
        latestWithoutAction([cause]);
        const { build, menu, post } = ancestor();
        assert.equal(await jobRunner.resume(), false);
        sinon.assert.neverCalledWith(request.json, build.apiUrl);
        sinon.assert.notCalled(menu);
        sinon.assert.notCalled(post);
        sinon.assert.notCalled(resumeRequest);
        assert.deepEqual(cli._calls.stopSpinner.at(-1), [
          unavailableMessage, cli.SPINNER_STATUS.FAILED
        ]);
      });
    }

    for (const state of [
      { result: 'SUCCESS', building: false },
      { result: 'UNSTABLE', building: false },
      { result: 'FAILURE', building: true }
    ]) {
      it(`stops at an ancestor in state ${JSON.stringify(state)}`, async() => {
        latestWithoutAction([resumeCause(ancestorId)]);
        const { data, menu, post } = ancestor(ancestorId, {
          causes: [resumeCause(ancestorId - 1)]
        });
        Object.assign(data, state);
        const older = ancestor(ancestorId - 1);
        assert.equal(await jobRunner.resume(), false);
        sinon.assert.notCalled(menu);
        sinon.assert.notCalled(post);
        sinon.assert.neverCalledWith(request.json, older.build.apiUrl);
      });
    }

    it('stops when the resume lineage points back to a newer build', async() => {
      latestWithoutAction([resumeCause(ancestorId)]);
      const { post } = ancestor(ancestorId, { resumable: false, causes: [resumeCause(jobid)] });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(post);
      sinon.assert.notCalled(resumeRequest);
      sinon.assert.calledOnce(menuRequest);
    });

    it('does not recover through ancestry when the latest menu lookup fails', async() => {
      latestWithoutAction([resumeCause(ancestorId)]);
      menuRequest.rejects(new Error('Connection reset'));
      const { build, menu, post } = ancestor();
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.neverCalledWith(request.json, build.apiUrl);
      sinon.assert.notCalled(menu);
      sinon.assert.notCalled(post);
      assert.match(cli._calls.stopSpinner.at(-1)[0], /Connection reset/);
    });

    for (const operation of ['metadata', 'menu']) {
      it(`does not skip an ancestor after a failed ${operation} lookup`, async() => {
        latestWithoutAction([resumeCause(ancestorId), resumeCause(ancestorId - 1)]);
        const { build, menu, post } = ancestor();
        if (operation === 'metadata') {
          request.json.withArgs(build.apiUrl).rejects(new Error('Unavailable ancestor metadata'));
        } else {
          menu.rejects(new Error('Unavailable ancestor menu'));
        }
        const older = ancestor(ancestorId - 1);
        assert.equal(await jobRunner.resume(), false);
        sinon.assert.notCalled(post);
        sinon.assert.notCalled(older.menu);
        sinon.assert.neverCalledWith(request.json, older.build.apiUrl);
        assert.match(cli._calls.stopSpinner.at(-1)[0], /Unavailable ancestor/);
      });
    }

    it('rechecks current PR HEAD before resuming an ancestor', async() => {
      latestWithoutAction([resumeCause(ancestorId)]);
      const { post } = ancestor();
      request.json.withArgs(prURL).resolves({ head: { sha: 'b'.repeat(40) } });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(post);
      sinon.assert.notCalled(resumeRequest);
      assert.match(cli._calls.error.at(-1)[0], /does not match the current PR HEAD/);
    });
  });

  for (const url of [
    'resume', 'resume/', `${jobURL}resume`, `${jobURL}resume/`,
    new URL(`${jobURL}resume`).pathname, new URL(`${jobURL}resume/`).pathname
  ]) {
    it(`recognizes the build's resume action URL: ${url}`, async() => {
      menuRequest.resolves({ status: 200, json: async() => ({ items: [{ url }] }) });
      assert.equal(await jobRunner.resume(), true);
      sinon.assert.calledOnce(resumeRequest);
    });

    it(`recognizes the new build page's resume event URL: ${url}`, async() => {
      // Jenkins' new build page exports Action.getEvent(), rather than the
      // plugin's POST sidebar task. Its default event type is GET.
      menuRequest.resolves({
        status: 200,
        json: async() => ({ items: [{ url: null, event: { url, type: 'GET' } }] })
      });
      assert.equal(await jobRunner.resume(), true);
      sinon.assert.calledOnceWithExactly(resumeRequest, `${jobURL}resume/`, {
        method: 'POST', headers: { 'Jenkins-Crumb': crumb }
      });
    });
  }

  it('recognizes a resume event when the top-level URL is omitted', async() => {
    menuRequest.resolves({
      status: 200,
      json: async() => ({ items: [{ event: { url: 'resume', type: 'GET' } }] })
    });
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnceWithExactly(resumeRequest, `${jobURL}resume/`, {
      method: 'POST', headers: { 'Jenkins-Crumb': crumb }
    });
  });

  it('rejects malformed resume events and event URLs for other builds or servers', async() => {
    menuRequest.resolves({
      status: 200,
      json: async() => ({
        items: [
          { event: null }, { event: {} }, { event: { url: false } },
          { event: { url: 'http://[' } },
          { event: { url: `${jobURL}console` }, displayName: 'Resume build' },
          { url: null, event: { url: '/job/node-test-pull-request/654320/resume' } },
          { event: { url: `${jobURL}resume?other=build` } },
          { event: { url: `${jobURL}resume#other` } },
          { event: { url: 'https://example.org/job/node-test-pull-request/654321/resume' } }
        ]
      })
    });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    sinon.assert.neverCalledWith(request.json, filesURL);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      unavailableMessage, cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('ignores malformed menu entries and resume links for other builds or servers', async() => {
    menuRequest.resolves({
      status: 200,
      json: async() => ({
        items: [
          null, {}, { url: false }, { url: 'http://[' },
          { url: `${jobURL}console`, displayName: 'Resume build' },
          { url: '/job/node-test-pull-request/654320/resume' },
          { url: `${jobURL}resume?other=build` },
          { url: `${jobURL}resume#other` },
          { url: 'https://example.org/job/node-test-pull-request/654321/resume' }
        ]
      })
    });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      unavailableMessage, cli.SPINNER_STATUS.FAILED
    ]);
  });

  for (const [status, statusText] of [
    [401, 'Unauthorized'], [403, 'Forbidden'], [404, 'Not Found'], [500, 'Internal Server Error']
  ]) {
    it(`reports HTTP ${status} while checking resume availability`, async() => {
      const cancel = sinon.stub().resolves();
      const json = sinon.stub();
      menuRequest.resolves({ status, statusText, body: { cancel }, json });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.calledOnce(cancel);
      sinon.assert.notCalled(json);
      sinon.assert.notCalled(resumeRequest);
      sinon.assert.neverCalledWith(request.json, filesURL);
      assert.deepEqual(cli._calls.stopSpinner.at(-1), [
        `Failed to check resume availability for PR CI job ${jobid}: ` +
          `Jenkins returned HTTP ${status} ${statusText}`,
        cli.SPINNER_STATUS.FAILED
      ]);
    });
  }

  for (const menu of [null, {}, { items: null }, { items: {} }]) {
    it(`reports an invalid build menu: ${JSON.stringify(menu)}`, async() => {
      menuRequest.resolves({ status: 200, json: async() => menu });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(resumeRequest);
      assert.deepEqual(cli._calls.stopSpinner.at(-1), [
        `Failed to check resume availability for PR CI job ${jobid}: ` +
          'Jenkins returned an invalid build context menu',
        cli.SPINNER_STATUS.FAILED
      ]);
    });
  }

  it('reports malformed JSON when checking resume availability', async() => {
    menuRequest.resolves({ status: 200, json: sinon.stub().rejects(new Error('Invalid JSON')) });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to check resume availability for PR CI job ${jobid}: Invalid JSON`,
      cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('reports a network error when checking resume availability', async() => {
    menuRequest.rejects(new Error('Connection reset'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to check resume availability for PR CI job ${jobid}: Connection reset`,
      cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('posts to the resume handler without redirecting the POST to a GET', async(t) => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    t.after(() => agent.close());
    const pool = agent.get('https://ci.nodejs.org');
    const jobPath = new URL(jobURL).pathname;
    const projectPath = '/job/node-test-pull-request/';
    pool.intercept({ path: `${jobPath}contextMenu`, method: 'GET' })
      .reply(200, { items: [{ url: `${jobPath}resume` }] });
    // Stapler redirects a slashless action URL before invoking its POST handler.
    pool.intercept({ path: `${jobPath}resume`, method: 'POST' })
      .reply(302, '', { headers: { location: `${jobPath}resume/` } });
    pool.intercept({ path: `${jobPath}resume/`, method: 'GET' }).reply(405, '');
    let resumed = 0;
    pool.intercept({ path: `${jobPath}resume/`, method: 'POST' }).reply(() => {
      resumed++;
      return { statusCode: 302, data: '', responseOptions: { headers: { location: projectPath } } };
    });
    pool.intercept({ path: projectPath, method: 'GET' }).reply(200, '');
    request.fetch.resetBehavior();
    request.fetch.callsFake((url, options) => fetch(url, { ...options, dispatcher: agent }));

    assert.equal(await jobRunner.resume(), true);
    assert.equal(resumed, 1);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), ['PR CI job successfully resumed']);
  });

  it('uses the latest PR CI link across the whole thread', async() => {
    request.gql.withArgs('PRComments').resolves([
      comment('https://ci.nodejs.org/job/node-test-commit/987654/', '2026-09-10T12:00:00Z'),
      comment('https://ci.nodejs.org/job/node-test-pull-request/123456/',
        '2026-09-08T13:00:00Z')
    ]);
    request.gql.withArgs('Reviews').resolves([comment(jobURL)]);
    assert.equal(await jobRunner.resume(), true);
    assert.equal(resumeRequest.firstCall.args[0], `${jobURL}resume/`);
  });

  it('finds CI links in the PR description', async() => {
    request.gql.withArgs('PRComments').resolves([]);
    request.gql.withArgs('PR').resolves({
      repository: {
        pullRequest: { bodyText: jobURL, createdAt: '2026-09-08T12:00:00Z' }
      }
    });
    assert.equal(await jobRunner.resume(), true);
    assert.equal(resumeRequest.firstCall.args[0], `${jobURL}resume/`);
  });

  for (const comments of [[], [comment('https://ci.nodejs.org/job/node-test-commit/123456/')]]) {
    it(`fails gracefully with ${comments.length ? 'only non-PR CI links' : 'no CI links'}`,
      async() => {
        request.gql.withArgs('PRComments').resolves(comments);
        assert.equal(await jobRunner.resume(), false);
        sinon.assert.notCalled(request.fetch);
        sinon.assert.calledOnceWithExactly(request.json, CI_CRUMB_URL);
        assert.deepEqual(cli._calls.stopSpinner.at(-1), [
          `No CI run detected from pull request ${prid}`, cli.SPINNER_STATUS.FAILED
        ]);
      });
  }

  for (const result of [null, 'SUCCESS', 'UNSTABLE', 'NOT_BUILT']) {
    it(`does not resume a job with result ${result}`, async() => {
      request.json.withArgs(apiURL).resolves({ result, building: result === null });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(request.fetch);
      assert.deepEqual(cli._calls.error, [
        [`CI job ${jobid} is in status ${result ?? 'RUNNING'}, skipping resume`]
      ]);
    });
  }

  it('does not resume a running job even if its result is FAILURE', async() => {
    request.json.withArgs(apiURL).resolves({ result: 'FAILURE', building: true });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('resumes an aborted job with an unexported resume action', async() => {
    request.json.withArgs(apiURL).resolves({ ...resumeBuildData, result: 'ABORTED' });
    request.json.withArgs(fullAPIURL).resolves({ ...failureBuildData, result: 'ABORTED' });
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(resumeRequest);
  });

  it('checks failed tests inside an aborted job before resuming', async() => {
    request.json.withArgs(apiURL).resolves({ ...resumeBuildData, result: 'ABORTED' });
    request.json.withArgs(fullAPIURL).resolves({ ...failureBuildData, result: 'ABORTED' });
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-example.js' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.error, [['test/parallel/test-example.js']]);
  });

  for (const result of ['FAILURE', 'ABORTED']) {
    it(`reports an unavailable resume endpoint for a ${result} job`, async() => {
      request.json.withArgs(apiURL).resolves({ ...resumeBuildData, result });
      resumeRequest.resolves({ status: 404, statusText: 'Not Found' });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.calledOnceWithExactly(resumeRequest, `${jobURL}resume/`, {
        method: 'POST',
        headers: { 'Jenkins-Crumb': crumb }
      });
      assert.deepEqual(cli._calls.stopSpinner.at(-1), [
        unavailableMessage, cli.SPINNER_STATUS.FAILED
      ]);
    });
  }

  it('does not resume an aborted job that is still building', async() => {
    request.json.withArgs(apiURL).resolves({
      ...resumeBuildData, result: 'ABORTED', building: true
    });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  for (const result of ['FAILURE', 'ABORTED']) {
    it(`refuses a ${result} job approved for a different PR HEAD`, async() => {
      request.json.withArgs(apiURL).resolves({ ...resumeBuildData, result });
      request.json.withArgs(prURL).resolves({ head: { sha: 'b'.repeat(40) } });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(resumeRequest);
      assert.match(cli._calls.error.at(-1)[0], /does not match the current PR HEAD/);
    });
  }

  for (const value of [undefined, '', false]) {
    it(`refuses a job without an approved commit: ${value}`, async() => {
      request.json.withArgs(apiURL).resolves({
        ...resumeBuildData,
        actions: [resumeBuildData.actions[0], {
          parameters: [{ name: 'COMMIT_SHA_CHECK', value }]
        }]
      });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(request.fetch);
      assert.match(cli._calls.error.at(-1)[0], /cannot determine its approved commit/);
    });
  }

  it('accepts repeated parameters for the same approved commit', async() => {
    request.json.withArgs(apiURL).resolves({
      ...resumeBuildData,
      actions: [...resumeBuildData.actions, resumeBuildData.actions[1]]
    });
    assert.equal(await jobRunner.resume(), true);
  });

  it('refuses conflicting approved commit parameters', async() => {
    request.json.withArgs(apiURL).resolves({
      ...resumeBuildData,
      actions: [...resumeBuildData.actions, {
        parameters: [{ name: 'COMMIT_SHA_CHECK', value: 'b'.repeat(40) }]
      }]
    });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('refuses when the current PR HEAD cannot be retrieved', async() => {
    request.json.withArgs(prURL).rejects(new Error('Unavailable'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to read the current HEAD for pull request ${prid}: Unavailable`,
      cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('does not fall back to an older failed job when the latest job is successful', async() => {
    request.gql.withArgs('PRComments').resolves([
      comment('https://ci.nodejs.org/job/node-test-pull-request/123456/',
        '2026-09-08T13:00:00Z'),
      comment(jobURL)
    ]);
    request.json.withArgs(apiURL).resolves({ result: 'SUCCESS', building: false });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
    assert.equal(request.json.callCount, 2);
    assert.equal(request.json.lastCall.args[0], apiURL);
  });

  for (const invalidCrumb of [undefined, '', false]) {
    it(`rejects an invalid Jenkins crumb: ${invalidCrumb}`, async() => {
      request.json.withArgs(CI_CRUMB_URL).resolves({ crumb: invalidCrumb });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(request.gql);
      sinon.assert.notCalled(request.fetch);
      assert.deepEqual(cli._calls.stopSpinner.at(-1), [
        'Unable to validate Jenkins credentials: Missing Jenkins crumb', cli.SPINNER_STATUS.FAILED
      ]);
    });
  }

  it('fails if Jenkins credentials cannot be validated', async() => {
    request.json.withArgs(CI_CRUMB_URL).rejects(new Error('Unauthorized'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.gql);
    sinon.assert.notCalled(request.fetch);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      'Unable to validate Jenkins credentials: Unauthorized', cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('fails if the PR cannot be loaded', async() => {
    request.gql.withArgs('PR').rejects(new Error('Not found'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to find CI runs for pull request ${prid}: Not found`, cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('fails if build data cannot be loaded', async() => {
    request.json.withArgs(apiURL).rejects(new Error('Not found'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to load PR CI job ${jobid}: Not found`, cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('fails if the resume request throws', async() => {
    resumeRequest.rejects(new Error('Connection reset'));
    assert.equal(await jobRunner.resume(), false);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to resume PR CI job ${jobid}: Connection reset`, cli.SPINNER_STATUS.FAILED
    ]);
  });

  for (const [status, statusText] of [[401, 'Unauthorized'], [403, 'Forbidden']]) {
    it(`reports HTTP ${status} with Jenkins credential and permission guidance`, async() => {
      resumeRequest.resolves({ status, statusText });
      assert.equal(await jobRunner.resume(), false);
      assert.deepEqual(cli._calls.stopSpinner.at(-1), [
        `Failed to resume PR CI job ${jobid}: Jenkins denied the request ` +
          `(HTTP ${status} ${statusText}). Check your Jenkins credentials and build permissions.`,
        cli.SPINNER_STATUS.FAILED
      ]);
    });
  }

  it('reports a Jenkins failure with the build page URL', async() => {
    resumeRequest.resolves({ status: 500, statusText: 'Internal Server Error' });
    assert.equal(await jobRunner.resume(), false);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to resume PR CI job ${jobid}: Jenkins returned HTTP 500 Internal Server Error. ` +
        `Check the build page for details: ${jobURL}`,
      cli.SPINNER_STATUS.FAILED
    ]);
  });

  for (const filename of ['test/parallel/test-example.js', 'test/parallel/test-example.mjs']) {
    it(`refuses to resume a failed test changed by the PR: ${filename}`, async() => {
      request.json.withArgs(filesURL).resolves([{ filename }]);
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(resumeRequest);
      assert.deepEqual(cli._calls.error, [[filename]]);
      assert.deepEqual(cli._calls.info, [
        ['https://ci.nodejs.org/job/node-test-commit-linux-freestyle/1/consoleText']
      ]);
      assert.deepEqual(cli._calls.log, [[failureLog.trimEnd()]]);
    });
  }

  it('refuses when a fixture rename leaves a broken import in an unchanged test', async() => {
    request.text.resolves(failureLog.replace('AssertionError',
      "Error: Cannot find module '../fixtures/old-name.js'"));
    request.json.withArgs(filesURL).resolves([{
      filename: 'test/fixtures/new-name.js',
      previous_filename: 'test/fixtures/old-name.js'
    }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.error, [['test/fixtures/old-name.js']]);
  });

  for (const path of ['/workspace/src/node.cc:42:5', 'C:\\workspace\\src\\node.cc:42:5']) {
    it(`checks source paths in diagnostics: ${path}`, async() => {
      request.text.resolves(failureLog.replace('AssertionError', `${path}: AssertionError`));
      request.json.withArgs(filesURL).resolves([{ filename: 'src/node.cc' }]);
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(resumeRequest);
    });
  }

  it('checks compilation failures against changed source files', async() => {
    request.text.resolves('../src/node.cc:42:5: error: no matching function\n');
    request.json.withArgs(filesURL).resolves([{ filename: 'src/node.cc' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
  });

  it('does not match test names that only share a prefix', async() => {
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-exam.js' }]);
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(resumeRequest);
  });

  it('checks all failed tests', async() => {
    request.text.resolves(failureLog + failureLog.replace('test-example', 'test-second'));
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-second.js' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
  });

  it('checks failed tests even when an infrastructure error takes precedence', async() => {
    request.text.resolves('Read-only file system\n' + failureLog);
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-example.js' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
  });

  it('checks available failures even when another build log cannot be downloaded', async() => {
    const data = structuredClone(failureBuildData);
    const url = 'https://ci.nodejs.org/job/node-test-commit-linux-freestyle/2/';
    data.subBuilds[0].build.subBuilds.push({
      jobName: 'node-test-commit-linux-freestyle', result: 'FAILURE', url
    });
    request.json.withArgs(fullAPIURL).resolves(data);
    request.text.withArgs(`${url}consoleText`).rejects(new Error('Unavailable'));
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-example.js' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
  });

  it('cancels a matching log and never opens queued logs', async() => {
    const data = structuredClone(failureBuildData);
    data.subBuilds[0].build.subBuilds.push({
      jobName: 'node-test-commit-linux-freestyle', result: 'FAILURE',
      url: 'https://ci.nodejs.org/job/node-test-commit-linux-freestyle/2/'
    });
    request.json.withArgs(fullAPIURL).resolves(data);
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-example.js' }]);
    let opened = 0;
    let cancelled = false;
    request.stream = async function * () {
      opened++;
      try {
        yield Buffer.from(failureLog);
        assert.fail('Must not read the rest of the log');
      } finally {
        cancelled = true;
      }
    };
    assert.equal(await jobRunner.resume(), false);
    assert.equal(opened, 1);
    assert.equal(cancelled, true);
    sinon.assert.notCalled(resumeRequest);
  });

  it('continues to a matching log after a stream fails midway', async() => {
    const data = structuredClone(failureBuildData);
    data.subBuilds[0].build.subBuilds.push({
      jobName: 'node-test-commit-linux-freestyle', result: 'FAILURE',
      url: 'https://ci.nodejs.org/job/node-test-commit-linux-freestyle/2/'
    });
    request.json.withArgs(fullAPIURL).resolves(data);
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-example.js' }]);
    let active = false;
    let opened = 0;
    request.stream = async function * () {
      assert.equal(active, false);
      active = true;
      try {
        if (++opened === 1) {
          yield Buffer.from('incomplete output');
          throw new Error('Connection reset');
        }
        yield Buffer.from(failureLog);
      } finally {
        active = false;
      }
    };
    assert.equal(await jobRunner.resume(), false);
    assert.equal(opened, 2);
    sinon.assert.notCalled(resumeRequest);
  });

  it('checks later pages of changed files', async() => {
    request.json.withArgs(filesURL).resolves(
      Array.from({ length: 100 }, (_, i) => ({ filename: `doc/file-${i}.md` })));
    request.json.withArgs(filesURL.replace('&page=1', '&page=2')).resolves([
      { filename: 'test/parallel/test-example.js' }
    ]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
  });

  it('refuses to resume if fetching changed files fails', async() => {
    request.json.withArgs(filesURL).rejects(new Error('Unavailable'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to check failures for PR CI job ${jobid}: Unavailable`, cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('refuses to resume if GitHub returns an error response for changed files', async() => {
    request.json.withArgs(filesURL).resolves({ message: 'Not Found' });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(resumeRequest);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      `Failed to check failures for PR CI job ${jobid}: Unable to retrieve pull request files`,
      cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('allows resuming if failure logs cannot be downloaded', async() => {
    request.text.rejects(new Error('Unavailable'));
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(resumeRequest);
  });

  it('allows resuming if failures cannot be parsed', async() => {
    request.text.resolves('Unrecognized failure output');
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(resumeRequest);
  });

  it('allows resuming if detailed build data cannot be downloaded', async() => {
    request.json.withArgs(fullAPIURL).rejects(new Error('Unavailable'));
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(resumeRequest);
  });
});

describe('ncu-ci resume CLI', () => {
  const binary = fileURLToPath(new URL('../../bin/ncu-ci.js', import.meta.url));
  const requestURL = new URL('../../lib/request.js', import.meta.url).href;
  const jobURL = 'https://ci.nodejs.org/job/node-test-pull-request/654321/';
  const fullAPIURL = new PRBuild(null, null, 654321).apiUrl;
  const apiURL = `${jobURL}api/json?tree=${encodeURIComponent(resumeTree)}`;

  function run(t, args, hasCI = true, changedFile = 'README.md',
    buildData = resumeBuildData, headSHA = approvedSHA, resumeResponse = { status: 200 },
    contextMenu = { items: [{ url: 'resume' }] }, ancestor = null) {
    const dir = mkdtempSync(join(tmpdir(), 'ncu-ci-resume-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'ncurc'), JSON.stringify({ username: 'test', token: 'test' }));
    const ancestorBuild = ancestor && new PRBuild(null, null, ancestor.id, undefined, resumeTree);
    const ancestorFullAPIURL = ancestor && new PRBuild(null, null, ancestor.id).apiUrl;
    const script = `
      import assert from 'node:assert/strict';
      import Request from ${JSON.stringify(requestURL)};
      Request.prototype.gql = async (name, variables) => {
        assert.deepEqual(variables, { owner: 'nodejs', repo: 'node', prid: 123456 });
        if (name === 'PR') {
          return { repository: { pullRequest: { bodyText: '', createdAt: '2026-09-08' } } };
        }
        if (name === 'PRComments' && ${hasCI}) {
          return [{ bodyText: ${JSON.stringify(jobURL)}, publishedAt: '2026-09-09' }];
        }
        return [];
      };
      Request.prototype.json = async (url) => {
        if (${Boolean(ancestor)}) {
          if (url === ${JSON.stringify(ancestorBuild?.apiUrl)}) {
            return ${JSON.stringify(ancestor?.data)};
          }
          if (url === ${JSON.stringify(ancestorFullAPIURL)}) {
            return ${JSON.stringify(failureBuildData)};
          }
        }
        if (url.endsWith('/crumbIssuer/api/json')) return { crumb: 'test-crumb' };
        if (url === '/repos/nodejs/node/pulls/123456') {
          return { head: { sha: ${JSON.stringify(headSHA)} } };
        }
        if (url.startsWith('/repos/nodejs/node/pulls/123456/files?')) {
          return [{ filename: ${JSON.stringify(changedFile)} }];
        }
        if (url === ${JSON.stringify(fullAPIURL)}) return ${JSON.stringify(failureBuildData)};
        assert.equal(url, ${JSON.stringify(apiURL)});
        return ${JSON.stringify(buildData)};
      };
      Request.prototype.stream = async function * () {
        yield Buffer.from(${JSON.stringify(failureLog)});
      };
      Request.prototype.fetch = async (url, options) => {
        if (url === ${JSON.stringify(`${jobURL}contextMenu`)}) {
          assert.deepEqual(options, { method: 'GET', redirect: 'error' });
          return { status: 200, json: async () => (${JSON.stringify(contextMenu)}) };
        }
        if (${Boolean(ancestor)} &&
            url === ${JSON.stringify(`${ancestorBuild?.jobUrl}contextMenu`)}) {
          assert.deepEqual(options, { method: 'GET', redirect: 'error' });
          return { status: 200, json: async () => ({ items: [{ url: 'resume/' }] }) };
        }
        assert.equal(url, ${JSON.stringify(`${ancestorBuild?.jobUrl ?? jobURL}resume/`)});
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Jenkins-Crumb'], 'test-crumb');
        return ${JSON.stringify(resumeResponse)};
      };
      process.argv = [process.execPath, ${JSON.stringify(binary)}, ...${JSON.stringify(args)}];
      await import(${JSON.stringify(new URL('../../bin/ncu-ci.js', import.meta.url).href)});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: dir,
      env: { ...process.env, XDG_CONFIG_HOME: dir },
      encoding: 'utf8',
      timeout: 10000
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  }

  for (const args of [
    ['123456', '--owner', 'nodejs', '--repo', 'node'],
    ['https://github.com/nodejs/node/pull/123456']
  ]) {
    it(`accepts ${args[0]}`, (t) => {
      const { status, output } = run(t, ['resume', ...args]);
      assert.equal(status, 0, output);
      assert.match(output, /PR CI job successfully resumed/);
    });
  }

  it('exits unsuccessfully when no CI run is found', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      false);
    assert.equal(status, 1, output);
    assert.match(output, /No CI run detected from pull request 123456/);
    assert.doesNotMatch(output, /TypeError/);
  });

  it('rejects invalid PR IDs', (t) => {
    const { status, output } = run(t, ['resume', 'invalid', '--owner', 'nodejs', '--repo', 'node']);
    assert.equal(status, 1, output);
    assert.match(output, /Pull request ID must be a positive integer/);
  });

  it('requires repository information for numeric PR IDs', (t) => {
    const { status, output } = run(t, ['resume', '123456']);
    assert.equal(status, 1, output);
    assert.match(output, /GitHub repository is missing/);
    assert.match(output, /GitHub owner is missing/);
  });

  it('exits unsuccessfully when a failed test is changed by the PR', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'test/parallel/test-example.js');
    assert.equal(status, 1, output);
    assert.match(output, /Refusing to resume CI: failures reference files changed by this PR/);
    assert.match(output, /test\/parallel\/test-example.js/);
    assert.ok(output.includes('https://ci.nodejs.org/job/node-test-commit-linux-freestyle/1/consoleText'));
    assert.ok(output.includes(failureLog.trimEnd()));
    assert.doesNotMatch(output, /PR CI job successfully resumed/);
  });

  it('resumes an aborted job with an unexported resume action', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', { ...resumeBuildData, result: 'ABORTED' });
    assert.equal(status, 0, output);
    assert.match(output, /PR CI job successfully resumed/);
  });

  it('exits 1 when Jenkins rejects resuming an aborted job', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', { ...resumeBuildData, result: 'ABORTED' }, approvedSHA,
      { status: 404, statusText: 'Not Found' });
    assert.equal(status, 1, output);
    assert.match(output, /Cannot resume PR CI job 654321: Jenkins does not offer a "Resume build" action/);
    assert.ok(output.includes('Check the existing CI run in Jenkins and rebase the PR if needed. ' +
      'To start a new CI run manually: ncu-ci run https://github.com/nodejs/node/pull/123456'));
    assert.doesNotMatch(output, /request-ci|resume-ci/);
    assert.doesNotMatch(output, /PR CI job successfully resumed/);
  });

  it('exits 1 with manual recovery guidance when Jenkins offers no resume action', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', resumeBuildData, approvedSHA, { status: 200 }, { items: [] });
    assert.equal(status, 1, output);
    assert.match(output, /Cannot resume PR CI job 654321: Jenkins does not offer a "Resume build" action/);
    assert.ok(output.includes('Check the existing CI run in Jenkins and rebase the PR if needed. ' +
      'To start a new CI run manually: ncu-ci run https://github.com/nodejs/node/pull/123456'));
    assert.doesNotMatch(output, /request-ci|resume-ci/);
    assert.ok(output.includes(jobURL));
    assert.doesNotMatch(output, /Checking failures|Resuming PR CI|PR CI job successfully resumed/);
  });

  it('reports which ancestor is resumed when the latest run has no action', (t) => {
    const latest = {
      ...resumeBuildData,
      actions: [...resumeBuildData.actions, {
        causes: [{
          _class: 'com.tikal.jenkins.plugins.multijob.ResumeCause',
          upstreamProject: 'node-test-pull-request',
          upstreamBuild: 654320,
          upstreamUrl: 'job/node-test-pull-request/'
        }]
      }]
    };
    const ancestor = {
      id: 654320,
      data: {
        ...resumeBuildData,
        actions: [...resumeBuildData.actions, {
          parameters: [
            { name: 'TARGET_GITHUB_ORG', value: 'nodejs' },
            { name: 'TARGET_REPO_NAME', value: 'node' },
            { name: 'PR_ID', value: '123456' }
          ]
        }]
      }
    };
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', latest, approvedSHA, { status: 200 }, { items: [] }, ancestor);
    assert.equal(status, 0, output);
    assert.match(output, /Using resumable ancestor PR CI job 654320 for latest job 654321/);
    assert.match(output, /PR CI job successfully resumed/);
  });

  it('exits 1 when Jenkins returns an invalid build context menu', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', resumeBuildData, approvedSHA, { status: 200 }, {});
    assert.equal(status, 1, output);
    assert.match(output, /Failed to check resume availability for PR CI job 654321/);
    assert.match(output, /Jenkins returned an invalid build context menu/);
    assert.doesNotMatch(output, /PR CI job successfully resumed/);
  });

  it('exits 1 with credential guidance when Jenkins denies the resume request', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', resumeBuildData, approvedSHA, { status: 403, statusText: 'Forbidden' });
    assert.equal(status, 1, output);
    assert.match(output, /Jenkins denied the request \(HTTP 403 Forbidden\)/);
    assert.match(output, /Check your Jenkins credentials and build permissions/);
    assert.doesNotMatch(output, /PR CI job successfully resumed/);
  });

  it('exits 1 when the CI-approved commit differs from the PR HEAD', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', resumeBuildData, 'b'.repeat(40));
    assert.equal(status, 1, output);
    assert.match(output, /does not match the current PR HEAD/);
    assert.doesNotMatch(output, /PR CI job successfully resumed/);
  });
});
