import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  forceRunAsync,
  runAsync,
  runSync
} from '../../lib/run.js';

describe('runSync', () => {
  it('echo test', () => {
    const test = runSync('echo', ['test']).trim();
    assert.strictEqual(
      test,
      'test',
      'should run a sync cmd and return stdout'
    );
  });
  it('missing cmd', () => {
    assert.throws(
      () => { runSync('./not-a-cmd'); },
      /ENOENT/,
      'should throw an error'
    );
  });
});

describe('runAsync', () => {
  it('echo test', async() => {
    const test =
      (await runAsync('echo', ['test'], { captureStdout: true })).trim();
    assert.strictEqual(
      test,
      'test',
      'should run an async cmd and return stdout'
    );
  });
});

describe('forceRunAsync', () => {
  it('echo test', async() => {
    const test =
      await forceRunAsync('echo', ['test'], { captureStdout: true });
    assert.strictEqual(
      test.trim(),
      'test',
      'should run an async cmd and return stdout'
    );
  });
  it('missing cmd', async() => {
    assert.rejects(
      forceRunAsync('./not-a-cmd'),
      /ENOENT/,
      'should throw an error'
    );
  });
});
