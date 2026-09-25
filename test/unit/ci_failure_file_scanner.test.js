import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { fetch } from 'undici';
import { FailureFileScanner } from '../../lib/ci/failure_file_scanner.js';
import CIFailureParser from '../../lib/ci/ci_failure_parser.js';
import Request from '../../lib/request.js';

const filename = 'test/parallel/test-example.js';
const tap = (text) => `not ok 1 parallel/test-example\n  ---\n${text}\n  ...\n`;

async function scanFailure(text, files = [filename], size = 8192) {
  const buffer = Buffer.from(text);
  async function * source() {
    for (let offset = 0; offset < buffer.length; offset += size) {
      yield buffer.subarray(offset, offset + size);
    }
  }
  return new FailureFileScanner(files).scan(source());
}

async function scan(...args) {
  return (await scanFailure(...args))?.filename;
}

// Complete console diagnostics and truncated report excerpts from September 23–25, 2026.
const reliabilityFailures = JSON.parse(readFileSync(
  new URL('../fixtures/ci-reliability-failures.json', import.meta.url), 'utf8'));
const makeFailure = JSON.parse(readFileSync(
  new URL('../fixtures/ci-resume-make-failure.json', import.meta.url), 'utf8'));

describe('Reliability report diagnostics', () => {
  for (const { name, kind, filenames, log } of reliabilityFailures) {
    it(name, async() => {
      const expected = kind === 'failure' ? { filename: filenames[0], reason: log } : undefined;
      for (const size of [1, 31, 8192]) {
        assert.deepEqual(await scanFailure(`${log}\n`, filenames, size), expected);
        assert.equal(await scanFailure(`${log}\n`, ['test/unrelated.js'], size), undefined);
        if (kind === 'todo') {
          const unexpected = log.replace(/ # TODO :[^\n]*/, '');
          assert.deepEqual(await scanFailure(`${unexpected}\n`, filenames, size),
            { filename: filenames[0], reason: unexpected });
        }
      }
    });
  }
});

describe('Make recipe failure summaries', () => {
  const summary = makeFailure.summary;

  it('attributes a test timeout to the test rather than the make recipe', async() => {
    const log = `${makeFailure.failure}\n${summary}\n`;
    for (const size of [1, 31, 8192]) {
      assert.equal(await scan(log, ['Makefile'], size), undefined);
      assert.deepEqual(await scanFailure(log, ['Makefile', makeFailure.filename], size),
        { filename: makeFailure.filename, reason: makeFailure.failure });
    }
  });

  for (const [name, footer] of [
    ['recursive make', summary],
    ['top-level make', 'make: *** [Makefile:660: test-ci] Error 2'],
    ['gmake', 'gmake[2]: *** [Makefile:660: test-ci] Error 1'],
    ['segmentation fault', 'make[1]: *** [Makefile:660: test-ci] Segmentation fault (core dumped)'],
    ['abort', 'make[1]: *** [Makefile:660: test-ci] Aborted (core dumped)'],
    ['failed recipe', "Makefile:660: recipe for target 'test-ci' failed"],
    ['prefixed stdout', '  [out] make[1]: *** [Makefile:660: test-ci] Error 1'],
    ['prefixed stderr', "    [err] Makefile:660: recipe for target 'test-ci' failed"]
  ]) {
    it(`ignores a propagated exit summary: ${name}`, async() => {
      for (const size of [1, 31, 8192]) {
        assert.equal(await scan(`${footer}\n`, ['Makefile'], size), undefined);
      }
    });
  }

  for (const [name, log] of [
    ['preceding error', `error: unrelated failure\n${summary}\n`],
    ['following filesystem error', `${summary}\nRead-only file system\n`],
    ['following C++ failure', `${summary}\n[  FAILED  ] Example\n`],
    ['following filename', `${summary}\nMakefile\n`],
    ['TAP block', tap(`    ${summary}`)],
    ['git failure block',
      `Changes not staged for commit:\n${summary}\nno changes added to commit\n`]
  ]) {
    it(`does not use a propagated exit summary as failure context: ${name}`, async() => {
      for (const size of [1, 31, 8192]) {
        assert.equal(await scan(log, ['Makefile'], size), undefined);
      }
    });
  }

  it('continues to later failures and preserves the summary as output context', async() => {
    const failure = tap(`    ${summary}\n    AssertionError: failure`);
    const log = `${summary}\n${failure}`;
    assert.deepEqual(await scanFailure(log, ['Makefile', filename], 1),
      { filename, reason: failure.trimEnd() });
  });

  for (const [name, reason] of [
    ['missing separator', 'Makefile:123: *** missing separator. Stop.'],
    ['unterminated variable', 'Makefile:123: *** unterminated variable reference. Stop.'],
    ['recipe before target', 'Makefile:123: *** recipe commences before first target. Stop.'],
    ['invalid recipe', 'Makefile:123: error: invalid recipe'],
    ['unreadable makefile', 'fatal: Unable to read Makefile: No such file or directory']
  ]) {
    it(`retains a genuine Makefile diagnostic: ${name}`, async() => {
      for (const size of [1, 31, 8192]) {
        assert.deepEqual(await scanFailure(`${reason}\n`, ['Makefile'], size),
          { filename: 'Makefile', reason });
      }
    });
  }
});

describe('Streaming failure file scanner', () => {
  it('returns the matching TAP failure without duplicating chunk overlaps', async() => {
    const failure = tap('  severity: fail\n  AssertionError: expected true, received false');
    for (const size of [1, 31, 8192]) {
      assert.deepEqual(await scanFailure(`unrelated output\n${failure}trailing output\n`,
        [filename], size), { filename, reason: failure.trimEnd() });
    }
  });

  it('returns the diagnostic preceding a matching file', async() => {
    const reason = 'error: compilation failed\n  src/node.cc:42';
    assert.deepEqual(await scanFailure(`unrelated output\n${reason}\n`, ['src/node.cc'], 1),
      { filename: 'src/node.cc', reason });
  });

  it('returns the matching C++ failure with its preceding context', async() => {
    const reason = 'test/cctest/test-example.cc:42\nExpected: 1\nActual: 2\n[  FAILED  ] Example';
    assert.deepEqual(await scanFailure(`${reason}\n`, ['test/cctest/test-example.cc'], 1),
      { filename: 'test/cctest/test-example.cc', reason });
  });

  it('returns the matching git failure block', async() => {
    const reason = 'Changes not staged for commit:\n  modified: src/node.cc\n' +
      'no changes added to commit';
    assert.deepEqual(await scanFailure(`${reason}\n`, ['src/node.cc'], 1),
      { filename: 'src/node.cc', reason });
  });

  it('bounds giant lines while retaining both ends of the diagnostic', async() => {
    const reason = `src/node.cc ${'x'.repeat(200000)} error: failure`;
    const failure = await scanFailure(`${reason}\n`, ['src/node.cc'], 31);
    assert.equal(failure.filename, 'src/node.cc');
    assert.ok(failure.reason.length < 8300);
    assert.match(failure.reason, /^src\/node\.cc /);
    assert.match(failure.reason, /failure output truncated/);
    assert.match(failure.reason, / error: failure$/);
  });

  it('bounds giant TAP blocks while retaining the failure and final diagnostic', async() => {
    const text = tap(`${'  context\n'.repeat(10000)}  AssertionError: failure`);
    const failure = await scanFailure(text);
    assert.equal(failure.filename, filename);
    assert.ok(failure.reason.length < 8300);
    assert.match(failure.reason, /^not ok 1 parallel\/test-example/);
    assert.match(failure.reason, /failure output truncated/);
    assert.match(failure.reason, /AssertionError: failure\n {2}\.\.\.$/);
  });

  for (const message of [
    'src/node.cc: Read-only file system',
    'error C2143: src/node.cc',
    'java.io.IOException: src/node.cc',
    'fatal: src/node.cc',
    'ERROR: src/node.cc',
    'src/node.cc:42\n[  FAILED  ] Example',
    tap('  severity: fail\n  src/node.cc:42'),
    'Changes not staged for commit:\n  modified: src/node.cc\nno changes added to commit',
    'error: Your local changes to the following files\n  src/node.cc\n' +
      'Failed to merge in the changes.'
  ]) {
    it(`reuses failure patterns across parsers without regex state leaking: ${message}`,
      async() => {
        const log = `Build started\n${message}\n`;
        for (let i = 0; i < 3; i++) {
          assert.equal(await scan(log, ['src/node.cc'], 1), 'src/node.cc');
          const failures = new CIFailureParser({}, log).parse();
          assert.equal(failures.length, 1);
          assert.match(failures[0].reason, /src\/node\.cc/);
        }
      });
  }

  it('handles UTF-8, CRLF, escaped Windows paths, and markers split at every byte', async() => {
    const path = 'test/fixtures/é-example.js';
    const log = tap('  c:\\\\workspace\\\\test\\\\fixtures\\\\é-example.js:42:1')
      .replaceAll('\n', '\r\n');
    assert.equal(await scan(log, [path], 1), path);
    assert.deepEqual(await scanFailure(log, [path], 1),
      { filename: path, reason: log.replaceAll('\r', '').trimEnd() });
  });

  it('preserves literal backslashes in failure output', async() => {
    const failure = tap("  actual: '\\\\n'\n  expected: '\\\\t'");
    assert.deepEqual(await scanFailure(failure, [filename], 1),
      { filename, reason: failure.trimEnd() });
  });

  it('requires a real path boundary across chunks', async() => {
    assert.equal(await scan(tap('').replace('test-example', 'test-example-long'),
      [filename], 1), undefined);
    assert.equal(await scan('src/node.cc-extra: error: failure\n', ['src/node.cc'], 1),
      undefined);
  });

  it('does not turn a sliding window boundary into a path boundary', async() => {
    const log = `xsrc/node.cc${' '.repeat(245)}error: failure\n`;
    assert.equal(await scan(log, ['src/node.cc'], 256), undefined);
  });

  it('ignores successful tests and ordinary path mentions', async() => {
    assert.equal(await scan(`ok 1 parallel/test-example\n${filename}\n`), undefined);
  });

  it('ignores expected failures even when TODO appears late in a large block', async() => {
    const log = tap(`  ${'x'.repeat(200000)}\n  # TODO : expected failure`);
    assert.equal(await scan(log, [filename], 31), undefined);
  });

  it('recognizes a later failure after a TODO block', async() => {
    assert.equal(await scan(tap('  # TODO : expected') + tap('  actual failure')), filename);
  });

  it('handles indented and output-prefixed TAP endings captured by ncu-ci walk', async() => {
    for (const ending of ['      ...\n', '    [out]   ...\n']) {
      assert.equal(await scan(`not ok 1 parallel/test-example\n${ending}`, [filename], 1),
        filename);
    }
  });

  it('retains a filename until a diagnostic at the other end of a giant line', async() => {
    assert.equal(await scan(`src/node.cc ${'x'.repeat(200000)} error: failure\n`,
      ['src/node.cc']), 'src/node.cc');
  });

  it('does not treat an incomplete TAP block as a confirmed failure', async() => {
    assert.equal(await scan('not ok 1 parallel/test-example\n  partial output'), undefined);
  });

  it('does not carry an unfinished failure into another log when reused', async() => {
    const scanner = new FailureFileScanner([filename]);
    assert.equal(await scanner.scan([Buffer.from('not ok 1 parallel/test-example\n')]),
      undefined);
    assert.equal(await scanner.scan([Buffer.from('unrelated output\n  ...\n')]), undefined);
    assert.deepEqual(await scanner.scan([Buffer.from(tap('  actual failure'))]),
      { filename, reason: tap('  actual failure').trimEnd() });
  });

  it('matches a compiler diagnostic without a final newline', async() => {
    assert.equal(await scan('../src/node.cc:42: error: failure', ['src/node.cc'], 1),
      'src/node.cc');
  });

  it('keeps compiler and C++ failure context', async() => {
    assert.equal(await scan('error: compilation failed\n  src/node.cc:42\n', ['src/node.cc']),
      'src/node.cc');
    assert.equal(await scan('test/cctest/test-example.cc:42\nmessage\n[  FAILED  ] Example\n',
      ['test/cctest/test-example.cc']), 'test/cctest/test-example.cc');
  });

  it('does not retain diagnostic context indefinitely', async() => {
    assert.equal(await scan(`error: unrelated\n${'unrelated\n'.repeat(6)}${filename}\n`),
      undefined);
  });

  it('scans 256 MiB of giant lines and TAP output with a 32 MiB heap', () => {
    const scannerURL = new URL('../../lib/ci/failure_file_scanner.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--max-old-space-size=32',
      '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { FailureFileScanner } from ${JSON.stringify(scannerURL)};
      const chunk = Buffer.alloc(65536, 120);
      async function * source() {
        // A 128 MiB line with its filename and diagnostic at opposite ends.
        yield Buffer.from('src/unrelated.cc ');
        for (let i = 0; i < 2048; i++) yield chunk;
        yield Buffer.from(' error: compilation failed\\n');
        yield Buffer.from('not ok 1 parallel/test-example\\n  ---\\n');
        for (let i = 0; i < 2048; i++) yield chunk;
        yield Buffer.from('\\n  ...\\n');
      }
      const failure = await new FailureFileScanner([${JSON.stringify(filename)}]).scan(source());
      assert.equal(failure.filename, ${JSON.stringify(filename)});
      assert.ok(failure.reason.length < 8300);
    `], { encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

describe('Streaming HTTP logs', () => {
  async function server(t, handler) {
    const instance = createServer(handler);
    instance.listen(0, '127.0.0.1');
    await once(instance, 'listening');
    t.after(() => {
      instance.closeAllConnections();
      instance.close();
    });
    return `http://127.0.0.1:${instance.address().port}/consoleText`;
  }

  const request = Object.assign(Object.create(Request.prototype), { fetch });

  it('cancels the HTTP response without downloading its remaining body', async(t) => {
    let responseClosed;
    let sent = 0;
    const url = await server(t, async(_req, res) => {
      responseClosed = once(res, 'close');
      res.write(tap('  failure'));
      const chunk = Buffer.alloc(65536);
      while (!res.destroyed && sent < 1024 * 1024 * 1024) {
        if (!res.write(chunk)) {
          await Promise.race([once(res, 'drain'), responseClosed]);
        }
        sent += chunk.length;
        await setImmediate();
      }
    });
    assert.deepEqual(await new FailureFileScanner([filename]).scan(request.stream(url)),
      { filename, reason: tap('  failure').trimEnd() });
    await responseClosed;
    assert.ok(sent < 1024 * 1024 * 1024, `Downloaded ${sent} trailing bytes`);
  });

  it('scans a gzip-encoded HTTP response without double decompression', async(t) => {
    const url = await server(t, (req, res) => {
      assert.match(req.headers['accept-encoding'], /gzip/);
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.end(gzipSync(tap('  failure')));
    });
    assert.deepEqual(await new FailureFileScanner([filename]).scan(request.stream(url)),
      { filename, reason: tap('  failure').trimEnd() });
  });

  it('cancels an error response instead of scanning its body', async(t) => {
    const url = await server(t, (_req, res) => {
      res.writeHead(404);
      res.end(tap('  failure'));
    });
    await assert.rejects(new FailureFileScanner([filename]).scan(request.stream(url)), /404/);
  });
});
