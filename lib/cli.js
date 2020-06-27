'use strict';

const ora = require('ora');
const chalk = require('chalk');
const inquirer = require('inquirer');

const { warning, error, info, success } = require('./figures');

const SPINNER_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  WARN: 'warn',
  INFO: 'info'
};

const { SUCCESS, FAILED, WARN, INFO } = SPINNER_STATUS;

const QUESTION_TYPE = {
  INPUT: 'input',
  NUMBER: 'number',
  CONFIRM: 'confirm'
};

function head(text, length = 11) {
  return chalk.bold(text.padEnd(length));
}

class CLI {
  constructor(stream) {
    this.stream = stream || process.stderr;
    this.spinner = ora({ stream: this.stream });
    this.SPINNER_STATUS = SPINNER_STATUS;
    this.QUESTION_TYPE = QUESTION_TYPE;
    this.figureIndent = '   ';
    this.assumeYes = false;
  }

  get eolIndent() {
    return `\n${this.figureIndent}`;
  }

  setFigureIndent(indent) {
    this.figureIndent = ' '.repeat(indent);
  }

  async prompt(question, opts = {
    defaultAnswer: true,
    noSeparator: false,
    questionType: 'confirm'
  }) {
    if (!opts.noSeparator) {
      this.separator();
    }

    const questionType = opts.questionType || QUESTION_TYPE.CONFIRM;
    const availableTypes = Object.values(QUESTION_TYPE);
    if (!availableTypes.includes(questionType)) {
      throw new Error(
        `${questionType} must be one of ${availableTypes.join(', ')}`);
    }

    const defaultAnswer = (opts.defaultAnswer === undefined)
      ? true : opts.defaultAnswer;
    if (typeof defaultAnswer === 'boolean' &&
        questionType !== QUESTION_TYPE.CONFIRM) {
      throw new Error(
        'defaultAnswer must be provided for non-confirmation prompts');
    }

    if (this.assumeYes) {
      return defaultAnswer;
    }

    const { answer } = await inquirer.prompt([{
      type: questionType,
      name: 'answer',
      message: question,
      default: defaultAnswer
    }]);

    return answer;
  }

  setAssumeYes() {
    this.assumeYes = true;
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
    this.write(text + '\n');
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
    const prefix = options.newline ? this.eolIndent : this.figureIndent;
    this.log(`${prefix}${success}  ${text}`);
  }

  warn(text, options = {}) {
    const prefix = options.newline ? this.eolIndent : this.figureIndent;
    this.log(prefix + chalk.bold(`${warning}  ${text}`));
  }

  info(text, options = {}) {
    const prefix = options.newline ? this.eolIndent : this.figureIndent;
    this.log(`${prefix}${info}  ${text}`);
  }

  error(obj, options = {}) {
    const prefix = options.newline ? this.eolIndent : this.figureIndent;
    if (obj instanceof Error) {
      this.log(`${prefix}${error}  ${obj.message}`);
      this.log(`${obj.stack}`);
      if (obj.data) {
        this.log(`${JSON.stringify(obj.data, null, 2)}`);
      }
    } else {
      this.log(prefix + chalk.bold(`${error}  ${obj}`));
    }
  }

  setExitCode(statusCode) {
    process.exitCode = statusCode;
  }
};

CLI.SPINNER_STATUS = SPINNER_STATUS;
CLI.QUESTION_TYPE = QUESTION_TYPE;

module.exports = CLI;
