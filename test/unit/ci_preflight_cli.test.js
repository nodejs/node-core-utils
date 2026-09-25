import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binaryURL = new URL('../../bin/ncu-ci.js', import.meta.url);
const requestURL = new URL('../../lib/request.js', import.meta.url);
const undiciURL = import.meta.resolve('undici');
const jobURL = 'https://ci.nodejs.org/job/node-test-pull-request/';
const root = (data, extra = {}) => ({
  path: '/api/json', tree: 'quietingDown', data, ...extra
});
const job = (data, extra = {}) => ({
  path: '/job/node-test-pull-request/api/json', tree: 'disabled,buildable', data, ...extra
});
const queue = (data, extra = {}) => ({
  path: '/queue/api/json', tree: 'items[id,task[url]]', data, ...extra
});
const computers = (data, extra = {}) => ({
  path: '/computer/api/json',
  tree: 'computer[executors[currentExecutable[url,queueId]],' +
    'oneOffExecutors[currentExecutable[url,queueId]]]',
  data,
  ...extra
});
const idleComputers = () => computers({ computer: [] });
const running = (number, queueId = number) => ({
  currentExecutable: { url: `${jobURL}${number}/`, queueId }
});

function run(t, command, responses, credentials = {
  username: 'test', jenkins_token: 'test-jenkins-token'
}) {
  const dir = mkdtempSync(join(tmpdir(), 'ncu-ci-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // These commands must not require a GitHub token or repository configuration.
  writeFileSync(join(dir, 'ncurc'), JSON.stringify(credentials));
  const tracePath = join(dir, 'requests.json');
  const script = `
    import assert from 'node:assert/strict';
    import { writeFileSync } from 'node:fs';
    import http from 'node:http';
    import https from 'node:https';
    import { MockAgent, setGlobalDispatcher } from ${JSON.stringify(undiciURL)};
    import Request from ${JSON.stringify(requestURL.href)};

    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    http.request = https.request = http.get = https.get = () => {
      assert.fail('Unexpected network access or GitHub authentication');
    };
    const trace = { requests: [], timeouts: [], jsonReads: 0, cancellations: 0 };
    process.on('exit', () => {
      writeFileSync(${JSON.stringify(tracePath)}, JSON.stringify(trace));
    });
    const timeout = AbortSignal.timeout;
    AbortSignal.timeout = (delay) => {
      trace.timeouts.push(delay);
      return timeout.call(AbortSignal, delay);
    };
    let signal;
    const responses = ${JSON.stringify(responses)};
    Request.prototype.fetch = async function (url, options) {
      const response = responses[trace.requests.length];
      assert.ok(response, 'Unexpected request: ' + url);
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://ci.nodejs.org');
      assert.equal(parsed.pathname, response.path);
      assert.equal(parsed.searchParams.get('tree'), response.tree);
      assert.equal([...parsed.searchParams].length, 1);
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Accept, 'application/json');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      if (signal) assert.equal(options.signal, signal);
      signal = options.signal;
      assert.equal(this.getJenkinsHeaders().Authorization,
        'Basic ' + Buffer.from('test:test-jenkins-token').toString('base64'));
      trace.requests.push(url);
      if (response.error) throw new Error(response.error);
      const status = response.status ?? 200;
      return {
        status,
        statusText: response.statusText ?? 'OK',
        ok: status >= 200 && status < 300,
        body: { async cancel() { trace.cancellations++; } },
        async json() {
          trace.jsonReads++;
          if (response.jsonError) throw new SyntaxError(response.jsonError);
          return response.data;
        }
      };
    };
    process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(binaryURL))},
      ${JSON.stringify(command)}];
    await import(${JSON.stringify(binaryURL.href)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: dir,
    env: { ...process.env, XDG_CONFIG_HOME: dir, NCU_VERBOSITY: 'NONE' },
    encoding: 'utf8',
    timeout: 10000
  });
  assert.ifError(result.error);
  const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
  assert.equal(trace.requests.length, responses.length, result.stdout + result.stderr);
  assert.deepEqual(trace.timeouts, responses.length ? [20000] : [], result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr,
    /first time running|create an access token|Unexpected network|AssertionError/);
  return { ...result, trace };
}

function assertFailure(result, reason) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.notEqual(result.stderr.trim(), '');
  assert.equal(result.stderr.trim().split('\n').length, 1, result.stderr);
  assert.doesNotMatch(result.stderr, /\n\s+at |SyntaxError|TypeError|\[DEBUG\]/);
  if (reason) assert.match(result.stderr, reason);
}

describe('ncu-ci available', () => {
  it('quietly confirms readiness with Jenkins-only credentials and one shared timeout', (t) => {
    const result = run(t, 'available', [
      root({ quietingDown: false }), job({ disabled: false, buildable: true })
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(result.trace.jsonReads, 2);
  });

  for (const data of [
    { quietingDown: true }, {}, null, { quietingDown: null }, { quietingDown: 'false' }
  ]) {
    it(`skips the job query when readiness is unconfirmed: ${JSON.stringify(data)}`, (t) => {
      assertFailure(run(t, 'available', [root(data)]));
    });
  }

  for (const data of [
    { disabled: true, buildable: false },
    { disabled: false, buildable: false },
    { disabled: false },
    { buildable: true },
    { disabled: 'false', buildable: true },
    { disabled: false, buildable: 'true' },
    null
  ]) {
    it(`refuses an unavailable or unknown PR job state: ${JSON.stringify(data)}`, (t) => {
      assertFailure(run(t, 'available', [root({ quietingDown: false }), job(data)]));
    });
  }

  it('reports an HTTP failure without parsing the error response', (t) => {
    const result = run(t, 'available', [
      root(null, { status: 503, statusText: 'Service Unavailable' })
    ]);
    assertFailure(result, /503/);
    assert.equal(result.trace.jsonReads, 0);
    assert.equal(result.trace.cancellations, 1);
  });

  it('reports malformed Jenkins JSON without a stack trace', (t) => {
    assertFailure(run(t, 'available', [root(null, { jsonError: 'Invalid Jenkins JSON' })]),
      /Jenkins returned invalid JSON/);
  });

  it('reports a job lookup failure after Jenkins reports ready', (t) => {
    assertFailure(run(t, 'available', [
      root({ quietingDown: false }), job(null, { error: 'Connection reset' })
    ]), /Connection reset/);
  });

  it('rejects malformed Jenkins credentials without printing the token or prompting', (t) => {
    const result = run(t, 'available', [], {
      username: 'test', jenkins_token: 'secret-invalid-token!'
    });
    assertFailure(result, /Configure username and jenkins_token with ncu-config/);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-invalid-token/);
  });
});

describe('ncu-ci workload', () => {
  it('prints only the number of unfinished and queued PR jobs', (t) => {
    const result = run(t, 'workload', [queue({
      items: [
        { id: 1, task: { url: jobURL } },
        { task: { url: 'https://ci.nodejs.org/job/node-test-commit/' } },
        { task: { url: `${jobURL}123/` } },
        { task: { url: 'https://example.org/job/node-test-pull-request/' } },
        { task: { url: 'https://ci.nodejs.org/job/node-test-pull-request-other/' } },
        { id: 2, task: { url: jobURL.slice(0, -1) } },
        { task: {} },
        { task: { url: null } },
        { id: 3, task: { url: jobURL } }
      ]
    }), idleComputers()]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '3\n');
    assert.equal(result.stderr, '');
  });

  it('includes running PR builds when the waiting queue is empty', (t) => {
    const result = run(t, 'workload', [queue({ items: [] }), computers({
      computer: [{
        executors: Array.from({ length: 3 }, (_, i) => running(i + 1)),
        oneOffExecutors: Array.from({ length: 17 }, (_, i) => running(i + 4))
      }]
    })]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '20\n');
    assert.equal(result.stderr, '');
    assert.equal(result.trace.jsonReads, 2);
  });

  it('combines queued and working PR builds without double counting transitions', (t) => {
    const result = run(t, 'workload', [queue({
      items: [
        { id: 10, task: { url: jobURL } },
        { id: 11, task: { url: jobURL } },
        { id: 12, task: { url: jobURL } }
      ]
    }), computers({
      computer: [{
        executors: [running(101, 10), running(102, 20), { currentExecutable: null }, {}],
        oneOffExecutors: [
          running(102, 20),
          { currentExecutable: { url: `${jobURL}102`, queueId: 20 } },
          { currentExecutable: { url: 'https://ci.nodejs.org/job/node-test-commit/1/' } },
          { currentExecutable: { url: 'https://example.org/job/node-test-pull-request/1/' } },
          { currentExecutable: {} }
        ]
      }]
    })]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '4\n');
    assert.equal(result.stderr, '');
  });

  for (const items of [[], [{ task: { url: 'https://ci.nodejs.org/job/node-test-commit/' } }]]) {
    it(`prints zero for a valid queue with no PR jobs: ${JSON.stringify(items)}`, (t) => {
      const result = run(t, 'workload', [queue({ items }), idleComputers()]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '0\n');
      assert.equal(result.stderr, '');
    });
  }

  for (const data of [null, {}, { items: null }, { items: {} }]) {
    it(`fails without a misleading count for invalid queue data: ${JSON.stringify(data)}`, (t) => {
      assertFailure(run(t, 'workload', [queue(data)]));
    });
  }

  for (const item of [null, {}, { task: null }, { task: false }, { task: { url: 123 } }]) {
    it(`fails for a malformed queue item: ${JSON.stringify(item)}`, (t) => {
      assertFailure(run(t, 'workload', [queue({ items: [item] })]));
    });
  }

  for (const id of [undefined, null, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects a queued PR item with invalid ID: ${JSON.stringify(id)}`, (t) => {
      assertFailure(run(t, 'workload', [queue({ items: [{ id, task: { url: jobURL } }] })]));
    });
  }

  for (const data of [
    null,
    {},
    { computer: null },
    { computer: {} },
    { computer: [{ executors: {}, oneOffExecutors: [] }] },
    { computer: [{ executors: [], oneOffExecutors: null }] },
    { computer: [{ executors: [{ currentExecutable: false }], oneOffExecutors: [] }] },
    { computer: [{ executors: [], oneOffExecutors: [{ currentExecutable: { url: 1 } }] }] }
  ]) {
    it(`fails without a partial count for invalid executor data: ${JSON.stringify(data)}`, (t) => {
      assertFailure(run(t, 'workload', [
        queue({ items: [{ id: 1, task: { url: jobURL } }] }), computers(data)
      ]));
    });
  }

  it('reports executor API failure without printing the already counted queue', (t) => {
    const result = run(t, 'workload', [
      queue({ items: [{ id: 1, task: { url: jobURL } }] }),
      computers(null, { status: 503, statusText: 'Service Unavailable' })
    ]);
    assertFailure(result, /503/);
    assert.equal(result.trace.jsonReads, 1);
    assert.equal(result.trace.cancellations, 1);
  });

  it('reports HTTP failures instead of printing zero', (t) => {
    const result = run(t, 'workload', [queue(null, { status: 403, statusText: 'Forbidden' })]);
    assertFailure(result, /403/);
    assert.equal(result.trace.jsonReads, 0);
    assert.equal(result.trace.cancellations, 1);
  });

  it('reports malformed JSON instead of printing zero', (t) => {
    assertFailure(run(t, 'workload', [queue(null, { jsonError: 'Invalid queue JSON' })]),
      /Jenkins returned invalid JSON/);
  });

  it('reports a network failure instead of printing zero', (t) => {
    assertFailure(run(t, 'workload', [queue(null, { error: 'Connection reset' })]),
      /Connection reset/);
  });
});
