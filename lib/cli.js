'use strict';

const ora = require('ora');
const { EOL } = require('os');
const chalk = require('chalk');

const { warning, error, info, success } = require('./figures');

const SPINNER_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  WARN: 'warn',
  INFO: 'info'
};
const { SUCCESS, FAILED, WARN, INFO } = SPINNER_STATUS;

function head(text, length = 8) {
  return chalk.bold(text.padEnd(length));
}

class CLI {
  constructor(stream) {
    this.stream = stream || process.stderr;
    this.spinner = ora({ stream });
    this.SPINNER_STATUS = SPINNER_STATUS;
  }

  startSpinner(text) {
    this.spinner.text = text;
    this.spinner.start();
  }

  updateSpinner(text) {
    this.spinner.text = text;
  }

  stopSpinner(rawText, status = SUCCESS) {
    let symbol;
    if (status === SUCCESS) {
      symbol = success;
    } else if (status === FAILED) {
      symbol = error;
    } else if (status === WARN) {
      symbol = warning;
    } else if (status === INFO) {
      symbol = info;
    }
    const text = ' ' + rawText;
    this.spinner.stopAndPersist({
      symbol, text
    });
  }

  write(text) {
    this.stream.write(text);
  }

  log(text) {
    this.write(text + EOL);
  }

  table(first, second, length) {
    this.log(head(first, length) + second);
  }

  separator(text = '', length = 80, sep = '-') {
    if (!text) {
      this.log(sep.repeat(length));
      return;
    }
    const rest = (length - text.length - 2);
    const half = sep.repeat(Math.floor(rest / 2));
    if (rest % 2 === 0) {
      this.log(`${half} ${chalk.bold(text)} ${half}`);
    } else {
      this.log(`${half} ${chalk.bold(text)} ${sep}${half}`);
    }
  }

  ok(text, options = {}) {
    const prefix = options.newline ? EOL : '';
    this.log(`${prefix}${success}  ${text}`);
  }

  warn(text, options = {}) {
    const prefix = options.newline ? EOL : '';
    this.log(`${prefix}${warning}  ${text}`);
  }

  info(text, options = {}) {
    const prefix = options.newline ? EOL : '';
    this.log(`${prefix}${info}  ${text}`);
  }

  error(obj, options = {}) {
    const prefix = options.newline ? EOL : '';
    if (obj instanceof Error) {
      this.log(`${prefix}${error}  ${obj.message}`);
      this.log(`${obj.stack}`);
      this.log(`${JSON.stringify(obj.data, null, 2).replace(/\n/g, EOL)}`);
    } else {
      this.log(`${prefix}${error}  ${obj}`);
    }
  }
};

module.exports = CLI;
