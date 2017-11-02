'use strict';

const { Writable } = require('stream');

const writtenSym = Symbol('written');
class LogStream extends Writable {
  constructor(options) {
    super(options);
    this[writtenSym] = '';
  }

  write(chunk, encoding, callback) {
    this[writtenSym] += chunk.toString();
  }

  toString() {
    return this[writtenSym];
  }
}

module.exports = LogStream;
