'use strict';

const ora = require('ora');
const { EOL } = require('os');
const chalk = require('chalk');
const read = require('read');
const { IGNORE } = require('./run');

const { warning, error, info, success } = require('./figures');
const FIGURE_INDENT = '   ';
const EOL_INDENT = `${EOL}${FIGURE_INDENT}`;

const SPINNER_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  WARN: 'warn',
  INFO: 'info'
};
const { SUCCESS, FAILED, WARN, INFO } = SPINNER_STATUS;

function head(text, length = 11) {
  return chalk.bold(text.padEnd(length));
}

class CLI {
  constructor(stream) {
    this.stream = stream || process.stderr;
    this.spinner = ora({ stream: this.stream });
    this.SPINNER_STATUS = SPINNER_STATUS;
  }

  promptForInput(question) {
    return new Promise((resolve, reject) => {
      read({ prompt: question }, (err, answer) => {
        if (err) {
          this.log(`\nCanceled: ${err.message}`);
          reject(new Error(IGNORE));
          return;
        }
        if (answer === undefined || answer === null) {
          reject(new Error(IGNORE));
          return;
        }
        resolve(answer);
      });
    });
  }

  async prompt(question, defaultAnswer = true) {
    const option =
      `[${(defaultAnswer ? 'Y' : 'y')}/${(defaultAnswer ? 'n' : 'N')}]`;
    this.separator();
    const promptText = `${chalk.bold.cyan('?')} ${question} ${option} `;

    const answer = await this.promptForInput(promptText);
    const trimmed = answer.toLowerCase().trim();
    if (!trimmed) {
      return defaultAnswer;
    } else if (trimmed === 'y') {
      return true;
    }
    return false;
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

  table(first, second = '', length = 11) {
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
    const prefix = options.newline ? EOL_INDENT : FIGURE_INDENT;
    this.log(`${prefix}${success}  ${text}`);
  }

  warn(text, options = {}) {
    const prefix = options.newline ? EOL_INDENT : FIGURE_INDENT;
    this.log(prefix + chalk.bold(`${warning}  ${text}`));
  }

  info(text, options = {}) {
    const prefix = options.newline ? EOL_INDENT : FIGURE_INDENT;
    this.log(`${prefix}${info}  ${text}`);
  }

  error(obj, options = {}) {
    const prefix = options.newline ? EOL_INDENT : FIGURE_INDENT;
    if (obj instanceof Error) {
      this.log(`${prefix}${error}  ${obj.message}`);
      this.log(`${obj.stack}`);
      if (obj.data) {
        this.log(`${JSON.stringify(obj.data, null, 2).replace(/\n/g, EOL)}`);
      }
    } else {
      this.log(prefix + chalk.bold(`${error}  ${obj}`));
    }
  }
};

CLI.SPINNER_STATUS = SPINNER_STATUS;

module.exports = CLI;
