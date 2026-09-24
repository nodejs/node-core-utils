import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sinon from 'sinon';

import { ResumePRJob } from '../../lib/ci/resume_ci.js';
import { CI_CRUMB_URL } from '../../lib/ci/run_ci.js';
import TestCLI from '../fixtures/test_cli.js';
import Request from '../../lib/request.js';
import { PRBuild } from '../../lib/ci/build-types/pr_build.js';

const approvedSHA = 'a'.repeat(40);
const resumeTree = 'result,building,actions[_class,parameters[name,value]]';
const resumeBuildData = {
  result: 'FAILURE',
  building: false,
  actions: [
    { _class: 'com.tikal.jenkins.plugins.multijob.MultiJobResumeBuild' },
    { parameters: [{ name: 'COMMIT_SHA_CHECK', value: approvedSHA }] }
  ]
};
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

describe('Resume file checks against real CI diagnostics', () => {
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
  const jobid = 654321;
  const crumb = 'asdf1234';
  const jobURL = `https://ci.nodejs.org/job/node-test-pull-request/${jobid}/`;
  const apiURL = `${jobURL}api/json?tree=${encodeURIComponent(resumeTree)}`;
  const fullAPIURL = new PRBuild(null, null, jobid).apiUrl;
  const filesURL = `/repos/${owner}/${repo}/pulls/${prid}/files?per_page=100&page=1`;
  const prURL = `/repos/${owner}/${repo}/pulls/${prid}`;
  const comment = (bodyText, publishedAt = '2026-09-09T12:00:00Z') =>
    ({ bodyText, publishedAt });
  let cli;
  let request;
  let jobRunner;

  beforeEach(() => {
    cli = new TestCLI();
    request = {
      json: sinon.stub().rejects(new Error('Unexpected JSON request')),
      gql: sinon.stub().rejects(new Error('Unexpected GraphQL request')),
      text: sinon.stub().resolves(failureLog),
      async * stream(url) { yield Buffer.from(await request.text(url)); },
      getPullRequestFiles: Request.prototype.getPullRequestFiles,
      getPullRequest: Request.prototype.getPullRequest,
      fetch: sinon.stub().resolves({ status: 200 })
    };
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

  it('resumes the PR job with a Jenkins crumb', async() => {
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnceWithExactly(request.fetch, `${jobURL}resume`, {
      method: 'POST',
      headers: { 'Jenkins-Crumb': crumb }
    });
    assert.equal(request.gql.callCount, 3);
    for (const call of request.gql.getCalls()) {
      assert.deepEqual(call.args[1], { owner, repo, prid });
    }
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
    assert.equal(request.fetch.firstCall.args[0], `${jobURL}resume`);
  });

  it('finds CI links in the PR description', async() => {
    request.gql.withArgs('PRComments').resolves([]);
    request.gql.withArgs('PR').resolves({
      repository: {
        pullRequest: { bodyText: jobURL, createdAt: '2026-09-08T12:00:00Z' }
      }
    });
    assert.equal(await jobRunner.resume(), true);
    assert.equal(request.fetch.firstCall.args[0], `${jobURL}resume`);
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

  it('resumes an aborted job with a resume action', async() => {
    request.json.withArgs(apiURL).resolves({ ...resumeBuildData, result: 'ABORTED' });
    request.json.withArgs(fullAPIURL).resolves({ ...failureBuildData, result: 'ABORTED' });
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(request.fetch);
  });

  it('checks failed tests inside an aborted job before resuming', async() => {
    request.json.withArgs(apiURL).resolves({ ...resumeBuildData, result: 'ABORTED' });
    request.json.withArgs(fullAPIURL).resolves({ ...failureBuildData, result: 'ABORTED' });
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-example.js' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
    assert.deepEqual(cli._calls.error, [['test/parallel/test-example.js']]);
  });

  for (const result of ['FAILURE', 'ABORTED']) {
    it(`refuses a ${result} job without a resume action`, async() => {
      request.json.withArgs(apiURL).resolves({ ...resumeBuildData, result, actions: [] });
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(request.fetch);
      assert.deepEqual(cli._calls.error, [[`CI job ${jobid} is not resumable`]]);
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
      sinon.assert.notCalled(request.fetch);
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
    sinon.assert.notCalled(request.fetch);
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
    });
  }

  it('fails if Jenkins credentials cannot be validated', async() => {
    request.json.withArgs(CI_CRUMB_URL).rejects(new Error('Unauthorized'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.gql);
    sinon.assert.notCalled(request.fetch);
  });

  it('fails if the PR cannot be loaded', async() => {
    request.gql.withArgs('PR').rejects(new Error('Not found'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('fails if build data cannot be loaded', async() => {
    request.json.withArgs(apiURL).rejects(new Error('Not found'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('fails if the resume request throws', async() => {
    request.fetch.rejects(new Error('Connection reset'));
    assert.equal(await jobRunner.resume(), false);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      'Failed to resume CI', cli.SPINNER_STATUS.FAILED
    ]);
  });

  it('reports a failed resume request', async() => {
    request.fetch.resolves({ status: 403, statusText: 'Forbidden' });
    assert.equal(await jobRunner.resume(), false);
    assert.deepEqual(cli._calls.stopSpinner.at(-1), [
      'Failed to resume PR CI: 403 Forbidden', cli.SPINNER_STATUS.FAILED
    ]);
  });

  for (const filename of ['test/parallel/test-example.js', 'test/parallel/test-example.mjs']) {
    it(`refuses to resume a failed test changed by the PR: ${filename}`, async() => {
      request.json.withArgs(filesURL).resolves([{ filename }]);
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(request.fetch);
      assert.deepEqual(cli._calls.error, [[filename]]);
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
    sinon.assert.notCalled(request.fetch);
    assert.deepEqual(cli._calls.error, [['test/fixtures/old-name.js']]);
  });

  for (const path of ['/workspace/src/node.cc:42:5', 'C:\\workspace\\src\\node.cc:42:5']) {
    it(`checks source paths in diagnostics: ${path}`, async() => {
      request.text.resolves(failureLog.replace('AssertionError', `${path}: AssertionError`));
      request.json.withArgs(filesURL).resolves([{ filename: 'src/node.cc' }]);
      assert.equal(await jobRunner.resume(), false);
      sinon.assert.notCalled(request.fetch);
    });
  }

  it('checks compilation failures against changed source files', async() => {
    request.text.resolves('../src/node.cc:42:5: error: no matching function\n');
    request.json.withArgs(filesURL).resolves([{ filename: 'src/node.cc' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('does not match test names that only share a prefix', async() => {
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-exam.js' }]);
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(request.fetch);
  });

  it('checks all failed tests', async() => {
    request.text.resolves(failureLog + failureLog.replace('test-example', 'test-second'));
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-second.js' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('checks failed tests even when an infrastructure error takes precedence', async() => {
    request.text.resolves('Read-only file system\n' + failureLog);
    request.json.withArgs(filesURL).resolves([{ filename: 'test/parallel/test-example.js' }]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
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
    sinon.assert.notCalled(request.fetch);
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
    sinon.assert.notCalled(request.fetch);
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
    sinon.assert.notCalled(request.fetch);
  });

  it('checks later pages of changed files', async() => {
    request.json.withArgs(filesURL).resolves(
      Array.from({ length: 100 }, (_, i) => ({ filename: `doc/file-${i}.md` })));
    request.json.withArgs(filesURL.replace('&page=1', '&page=2')).resolves([
      { filename: 'test/parallel/test-example.js' }
    ]);
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('refuses to resume if fetching changed files fails', async() => {
    request.json.withArgs(filesURL).rejects(new Error('Unavailable'));
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('refuses to resume if GitHub returns an error response for changed files', async() => {
    request.json.withArgs(filesURL).resolves({ message: 'Not Found' });
    assert.equal(await jobRunner.resume(), false);
    sinon.assert.notCalled(request.fetch);
  });

  it('allows resuming if failure logs cannot be downloaded', async() => {
    request.text.rejects(new Error('Unavailable'));
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(request.fetch);
  });

  it('allows resuming if failures cannot be parsed', async() => {
    request.text.resolves('Unrecognized failure output');
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(request.fetch);
  });

  it('allows resuming if detailed build data cannot be downloaded', async() => {
    request.json.withArgs(fullAPIURL).rejects(new Error('Unavailable'));
    assert.equal(await jobRunner.resume(), true);
    sinon.assert.calledOnce(request.fetch);
  });
});

describe('ncu-ci resume CLI', () => {
  const binary = fileURLToPath(new URL('../../bin/ncu-ci.js', import.meta.url));
  const requestURL = new URL('../../lib/request.js', import.meta.url).href;
  const jobURL = 'https://ci.nodejs.org/job/node-test-pull-request/654321/';
  const fullAPIURL = new PRBuild(null, null, 654321).apiUrl;
  const apiURL = `${jobURL}api/json?tree=${encodeURIComponent(resumeTree)}`;

  function run(t, args, hasCI = true, changedFile = 'README.md',
    buildData = resumeBuildData, headSHA = approvedSHA) {
    const dir = mkdtempSync(join(tmpdir(), 'ncu-ci-resume-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'ncurc'), JSON.stringify({ username: 'test', token: 'test' }));
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
        assert.equal(url, ${JSON.stringify(`${jobURL}resume`)});
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Jenkins-Crumb'], 'test-crumb');
        return { status: 200 };
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
    assert.doesNotMatch(output, /PR CI job successfully resumed/);
  });

  it('resumes an aborted job when Jenkins exposes the resume action', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', { ...resumeBuildData, result: 'ABORTED' });
    assert.equal(status, 0, output);
    assert.match(output, /PR CI job successfully resumed/);
  });

  it('exits 1 when an aborted job is not resumable', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', { ...resumeBuildData, result: 'ABORTED', actions: [] });
    assert.equal(status, 1, output);
    assert.match(output, /is not resumable/);
  });

  it('exits 1 when the CI-approved commit differs from the PR HEAD', (t) => {
    const { status, output } = run(t, ['resume', 'https://github.com/nodejs/node/pull/123456'],
      true, 'README.md', resumeBuildData, 'b'.repeat(40));
    assert.equal(status, 1, output);
    assert.match(output, /does not match the current PR HEAD/);
    assert.doesNotMatch(output, /PR CI job successfully resumed/);
  });
});
