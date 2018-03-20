'use strict';

const Cache = require('../../lib/cache');
const { tmpdir } = require('../common');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

describe('Cache', () => {
  const syncResult = 'content in sync';
  const asyncResult = {
    results: 'content in async.json'
  };

  class CachedClass {
    constructor(foo) {
      this.foo = foo;
      this.sync = 0;
      this.async = 0;
    }

    cachedSyncMethod(...args) {
      this.sync++;
      return syncResult;
    }

    async cachedAsyncMethod(...args) {
      this.async++;
      const p = Promise.resolve(asyncResult);
      const result = await p;  // make sure it's async
      return result;
    }

    getCacheKey(prefix, ...args) {
      return `${prefix}-${args.join('-')}-${this.foo}`;
    }
  }

  tmpdir.refresh();
  const cache = new Cache(tmpdir.path);
  cache.wrap(CachedClass, {
    cachedSyncMethod(...args) {
      return { key: this.getCacheKey('sync', ...args), ext: '.txt' };
    },
    cachedAsyncMethod(...args) {
      return { key: this.getCacheKey('async', ...args), ext: '.json' };
    }
  });

  it('should cache sync results', () => {
    tmpdir.refresh();
    cache.enable();
    const expected = syncResult;
    const instance = new CachedClass('foo');
    let actual = instance.cachedSyncMethod('test');
    assert.strictEqual(instance.sync, 1);
    assert.strictEqual(actual, expected);

    let syncCache = path.join(tmpdir.path, 'sync-test-foo.txt');
    let cached = fs.readFileSync(syncCache, 'utf8');
    assert.strictEqual(cached, expected);

    // Call it again
    actual = instance.cachedSyncMethod('test');
    assert.strictEqual(instance.sync, 1);
    assert.strictEqual(actual, expected);

    syncCache = path.join(tmpdir.path, 'sync-test-foo.txt');
    cached = fs.readFileSync(syncCache, 'utf8');
    assert.strictEqual(cached, expected);
  });

  it('should cache async results', async() => {
    tmpdir.refresh();
    cache.enable();
    const expected = Object.assign({}, asyncResult);
    const instance = new CachedClass('foo');
    let actual = await instance.cachedAsyncMethod('test');
    assert.strictEqual(instance.async, 1);
    assert.deepStrictEqual(actual, expected);

    let asyncCache = path.join(tmpdir.path, 'async-test-foo.json');
    let cached = JSON.parse(fs.readFileSync(asyncCache, 'utf8'));
    assert.deepStrictEqual(cached, expected);

    // Call it again
    actual = await instance.cachedAsyncMethod('test');
    assert.strictEqual(instance.async, 1);
    assert.deepStrictEqual(actual, expected);

    asyncCache = path.join(tmpdir.path, 'async-test-foo.json');
    cached = JSON.parse(fs.readFileSync(asyncCache, 'utf8'));
    assert.deepStrictEqual(cached, expected);
  });

  it('should not cache if disabled', async() => {
    tmpdir.refresh();
    cache.disable();
    const expected = Object.assign({}, asyncResult);
    const instance = new CachedClass('foo');
    let actual = await instance.cachedAsyncMethod('test');
    assert.strictEqual(instance.async, 1);
    assert.deepStrictEqual(actual, expected);

    let list = fs.readdirSync(tmpdir.path);
    assert.deepStrictEqual(list, []);

    // Call it again
    actual = await instance.cachedAsyncMethod('test');
    assert.strictEqual(instance.async, 2);
    assert.deepStrictEqual(actual, expected);

    list = fs.readdirSync(tmpdir.path);
    assert.deepStrictEqual(list, []);
  });
});
