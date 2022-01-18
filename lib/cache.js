import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { writeJson, readJson, writeFile, readFile } from './file.js';

function isAsync(fn) {
  return fn[Symbol.toStringTag] === 'AsyncFunction';
}

const parentDir = fileURLToPath(new URL('..', import.meta.url));

export default class Cache {
  constructor(dir) {
    this.dir = dir || this.computeCacheDir(parentDir);
    this.originals = {};
    this.disabled = true;
  }

  computeCacheDir(base) {
    return path.join(base, '.ncu', 'cache');
  }

  disable() {
    this.disabled = true;
  }

  enable() {
    this.disabled = false;
  }

  getFilename(key, ext) {
    return path.join(this.dir, key) + ext;
  }

  has(key, ext) {
    if (this.disabled) {
      return false;
    }

    return fs.existsSync(this.getFilename(key, ext));
  }

  get(key, ext) {
    if (!this.has(key, ext)) {
      return undefined;
    }
    if (ext === '.json') {
      return readJson(this.getFilename(key, ext));
    } else {
      return readFile(this.getFilename(key, ext));
    }
  }

  write(key, ext, content) {
    if (this.disabled) {
      return;
    }
    const filename = this.getFilename(key, ext);
    if (ext === '.json') {
      return writeJson(filename, content);
    } else {
      return writeFile(filename, content);
    }
  }

  wrapAsync(original, identity) {
    const cache = this;
    return async function(...args) {
      const { key, ext } = identity.call(this, ...args);
      const cached = cache.get(key, ext);
      if (cached) {
        return cached;
      }
      const result = await original.call(this, ...args);
      cache.write(key, ext, result);
      return result;
    };
  }

  wrapNormal(original, identity) {
    const cache = this;
    return function(...args) {
      const { key, ext } = identity.call(this, ...args);
      const cached = cache.get(key, ext);
      if (cached) {
        return cached;
      }
      const result = original.call(this, ...args);
      cache.write(key, ext, result);
      return result;
    };
  }

  wrap(Class, identities) {
    for (const method of Object.keys(identities)) {
      const original = Class.prototype[method];
      const identity = identities[method];
      this.originals[method] = original;
      if (isAsync(original)) {
        Class.prototype[method] = this.wrapAsync(original, identity);
      } else {
        Class.prototype[method] = this.wrapNormal(original, identity);
      }
    }
  }
}
