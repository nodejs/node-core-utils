import { Writable } from 'node:stream';

const writtenSym = Symbol('written');
export default class LogStream extends Writable {
  constructor(options) {
    super(options);
    this.isTTY = false;
    this[writtenSym] = '';
  }

  write(chunk, encoding, callback) {
    this[writtenSym] += chunk.toString();
  }

  toString() {
    return this[writtenSym];
  }

  clearLine() {}

  cursorTo() {}
}
