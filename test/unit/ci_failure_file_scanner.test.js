import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
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

async function scan(text, files = [filename], size = 8192) {
  const buffer = Buffer.from(text);
  async function * source() {
    for (let offset = 0; offset < buffer.length; offset += size) {
      yield buffer.subarray(offset, offset + size);
    }
  }
  return new FailureFileScanner(files).scan(source());
}

describe('Streaming failure file scanner', () => {
  for (const message of [
    'src/node.cc: Read-only file system',
    'error C2143: src/node.cc',
    'java.io.IOException: src/node.cc',
    'fatal: src/node.cc',
    'ERROR: src/node.cc'
  ]) {
    it(`reuses diagnostic patterns across parsers without regex state leaking: ${message}`,
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
    assert.equal(await scanner.scan([Buffer.from(tap('  actual failure'))]), filename);
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
      assert.equal(await new FailureFileScanner([${JSON.stringify(filename)}]).scan(source()),
        ${JSON.stringify(filename)});
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
    assert.equal(await new FailureFileScanner([filename]).scan(request.stream(url)), filename);
    await responseClosed;
    assert.ok(sent < 1024 * 1024 * 1024, `Downloaded ${sent} trailing bytes`);
  });

  it('scans a gzip-encoded HTTP response without double decompression', async(t) => {
    const url = await server(t, (req, res) => {
      assert.match(req.headers['accept-encoding'], /gzip/);
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.end(gzipSync(tap('  failure')));
    });
    assert.equal(await new FailureFileScanner([filename]).scan(request.stream(url)), filename);
  });

  it('cancels an error response instead of scanning its body', async(t) => {
    const url = await server(t, (_req, res) => {
      res.writeHead(404);
      res.end(tap('  failure'));
    });
    await assert.rejects(new FailureFileScanner([filename]).scan(request.stream(url)), /404/);
  });
});
