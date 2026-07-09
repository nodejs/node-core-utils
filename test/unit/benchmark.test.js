import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import * as sinon from 'sinon';

import BenchmarkSession from '../../lib/benchmark.js';

const QUESTION_TYPE = { INPUT: 'input', CONFIRM: 'confirm' };

// prompt() is used both for yes/no confirmations and for the free-text filter
// input; honour the prompt's defaultAnswer for confirmations and return an
// empty string for inputs.
function defaultPrompt(message, opts = {}) {
  if (opts.questionType === QUESTION_TYPE.INPUT) {
    return Promise.resolve('');
  }
  return Promise.resolve(opts.defaultAnswer ?? true);
}

function makeCli() {
  return {
    SPINNER_STATUS: { SUCCESS: 'success', FAILED: 'failed' },
    QUESTION_TYPE,
    startSpinner: sinon.stub(),
    stopSpinner: sinon.stub(),
    updateSpinner: sinon.stub(),
    separator: sinon.stub(),
    table: sinon.stub(),
    info: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub(),
    log: sinon.stub(),
    prompt: sinon.stub().callsFake(defaultPrompt),
    promptCheckbox: sinon.stub()
  };
}

const pr = {
  number: 123,
  head: {
    sha: 'deadbeef',
    repo: { full_name: 'nodejs/node' }
  },
  base: {
    ref: 'main',
    repo: { full_name: 'nodejs/node' }
  }
};

const contents = [
  { type: 'dir', name: 'buffers' },
  { type: 'dir', name: 'url' },
  { type: 'dir', name: 'fixtures' },
  { type: 'file', name: '_http-benchmarkers.js' }
];

function filesGenerator(files) {
  return async function * () {
    yield * files;
  };
}

function makeRequest() {
  return {
    getPullRequest: sinon.stub().resolves(pr),
    getPullRequestFiles: sinon.stub().callsFake(filesGenerator([])),
    listDirectory: sinon.stub().resolves(contents),
    dispatchWorkflow: sinon.stub().resolves({ ok: true })
  };
}

describe('BenchmarkSession', () => {
  let cli;
  let request;
  const baseArgv = { owner: 'nodejs', repo: 'node', prid: 123, ref: 'main' };

  beforeEach(() => {
    cli = makeCli();
    request = makeRequest();
  });

  it('lists categories excluding fixtures and non-dir entries', async() => {
    cli.promptCheckbox.resolves(['buffers']);
    const session = new BenchmarkSession(cli, request, { ...baseArgv });
    await session.start();

    const [, choices] = cli.promptCheckbox.firstCall.args;
    assert.deepStrictEqual(choices.map((c) => c.value), ['buffers', 'url']);
    assert.ok(request.listDirectory.calledOnce);
    assert.deepStrictEqual(request.listDirectory.firstCall.args[0], {
      owner: 'nodejs',
      repo: 'node',
      path: 'benchmark',
      ref: 'deadbeef'
    });
  });

  it('dispatches the workflow with the selected categories', async() => {
    cli.promptCheckbox.resolves(['buffers', 'url']);
    const session = new BenchmarkSession(cli, request, { ...baseArgv });
    await session.start();

    assert.ok(request.dispatchWorkflow.calledOnce);
    const [workflow, opts] = request.dispatchWorkflow.firstCall.args;
    assert.strictEqual(workflow, 'benchmark.yml');
    assert.strictEqual(opts.owner, 'nodejs');
    assert.strictEqual(opts.repo, 'node');
    assert.strictEqual(opts.ref, 'main');
    assert.deepStrictEqual(opts.inputs, {
      pr_id: '123',
      commit: 'deadbeef',
      category: 'buffers url',
      'post-comment': 'true'
    });
  });

  it('pre-checks categories touched by the PR', async() => {
    request.getPullRequestFiles.callsFake(filesGenerator([
      { filename: 'benchmark/url/url-parse.js' },
      { filename: 'lib/url.js' },
      { filename: 'benchmark/fixtures/foo.js' }
    ]));
    cli.promptCheckbox.resolves(['url']);
    const session = new BenchmarkSession(cli, request, { ...baseArgv });
    await session.start();

    const [, choices] = cli.promptCheckbox.firstCall.args;
    assert.deepStrictEqual(choices, [
      { name: 'buffers', value: 'buffers', checked: false },
      { name: 'url', value: 'url', checked: true }
    ]);
  });

  it('falls back to PR labels when no benchmark file is touched', async() => {
    request.getPullRequest.resolves({
      ...pr,
      labels: [{ name: 'buffer' }, { name: 'dont-land-on-v20.x' }]
    });
    cli.promptCheckbox.resolves(['buffers']);
    const session = new BenchmarkSession(cli, request, { ...baseArgv });
    await session.start();

    const [, choices] = cli.promptCheckbox.firstCall.args;
    assert.deepStrictEqual(choices, [
      { name: 'buffers', value: 'buffers', checked: true },
      { name: 'url', value: 'url', checked: false }
    ]);
  });

  it('pre-fills the filter when a single benchmark file is touched', async() => {
    request.getPullRequestFiles.callsFake(filesGenerator([
      { filename: 'benchmark/url/url-parse.js' }
    ]));
    cli.promptCheckbox.resolves(['url']);
    // Accept the pre-filled default answer for the filter prompt.
    cli.prompt.callsFake((message, opts = {}) =>
      Promise.resolve(opts.questionType === QUESTION_TYPE.INPUT
        ? opts.defaultAnswer
        : true));
    const session = new BenchmarkSession(cli, request, { ...baseArgv });
    await session.start();

    const [, opts] = request.dispatchWorkflow.firstCall.args;
    assert.strictEqual(opts.inputs.filter, 'url-parse');
  });

  it('uses the interactive filter prompt otherwise', async() => {
    cli.promptCheckbox.resolves(['buffers']);
    cli.prompt.callsFake((message, opts = {}) =>
      Promise.resolve(opts.questionType === QUESTION_TYPE.INPUT ? 'foo ' : true));
    const session = new BenchmarkSession(cli, request, { ...baseArgv });
    await session.start();

    const [, opts] = request.dispatchWorkflow.firstCall.args;
    assert.strictEqual(opts.inputs.filter, 'foo');
  });

  it('sets repo input when the workflow lives in another repository', async() => {
    cli.promptCheckbox.resolves(['buffers']);
    const session = new BenchmarkSession(cli, request, {
      ...baseArgv,
      workflowOwner: 'aduh95-evals',
      workflowRepo: 'node',
      runs: 10
    });
    await session.start();

    const [, opts] = request.dispatchWorkflow.firstCall.args;
    assert.strictEqual(opts.owner, 'aduh95-evals');
    assert.deepStrictEqual(opts.inputs, {
      pr_id: '123',
      commit: 'deadbeef',
      category: 'buffers',
      repo: 'nodejs/node',
      runs: '10',
      // The workflow lives in a different repo, so commenting defaults to off.
      'post-comment': 'false'
    });
  });

  it('benchmarks the provided commit instead of the PR head', async() => {
    cli.promptCheckbox.resolves(['buffers']);
    const session = new BenchmarkSession(cli, request, {
      ...baseArgv,
      commit: 'cafebabe'
    });
    await session.start();

    const [, opts] = request.dispatchWorkflow.firstCall.args;
    assert.strictEqual(opts.inputs.commit, 'cafebabe');
  });

  it('sets post-comment to false when the user declines the prompt', async() => {
    cli.promptCheckbox.resolves(['buffers']);
    // Decline the "comment on the PR?" prompt but confirm the final dispatch.
    cli.prompt.callsFake((message, opts = {}) => {
      if (/comment/i.test(message)) return Promise.resolve(false);
      return Promise.resolve(opts.questionType === QUESTION_TYPE.INPUT ? '' : true);
    });
    const session = new BenchmarkSession(cli, request, { ...baseArgv });
    await session.start();

    const [, opts] = request.dispatchWorkflow.firstCall.args;
    assert.strictEqual(opts.inputs['post-comment'], 'false');
  });

  it('does not dispatch when the confirmation prompt is declined', async() => {
    cli.promptCheckbox.resolves(['buffers']);
    cli.prompt.callsFake((message, opts = {}) =>
      Promise.resolve(opts.questionType === QUESTION_TYPE.INPUT ? '' : false));
    const session = new BenchmarkSession(cli, request, { ...baseArgv });
    await assert.rejects(session.start(), /__ignore__/);
    assert.ok(request.dispatchWorkflow.notCalled);
  });
});
