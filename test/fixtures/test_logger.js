'use strict';

class TestLogger {
  constructor() {
    this.logs = {
      warn: [],
      info: [],
      trace: [],
      error: []
    };
  }

  isEmpty() {
    for (const key of Object.keys(this.logs)) {
      if (this.logs[key].length !== 0) {
        return false;
      }
    }
    return true;
  }

  clear() {
    this.logs.warn = [];
    this.logs.info = [];
    this.logs.trace = [];
    this.logs.error = [];
  }

  warn(...args) {
    this.logs.warn.push(args);
  }

  info(...args) {
    this.logs.info.push(args);
  }

  trace(...args) {
    this.logs.trace.push(args);
  }

  error(...args) {
    this.logs.error.push(args);
  }
};

module.exports = TestLogger;
