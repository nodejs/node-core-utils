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
const root = (data, extra = {}) => ({
  path: '/api/json', tree: 'quietingDown', data, ...extra
});
const job = (data, extra = {}) => ({
  path: '/job/node-test-pull-request/api/json', tree: 'disabled,buildable', data, ...extra
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
