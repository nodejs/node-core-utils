'use strict';

const assert = require('assert');
const { EOL } = require('os');
const chalk = require('chalk');

const CLI = require('../../lib/cli');
const LogStream = require('../fixtures/log_stream');
const { warning, error, info, success } = require('../../lib/figures');

describe('cli', () => {
  let cli = null;
  let stream = null;

  describe('instantiation', () => {
    it('should set `process.stderr` as stream if no stream is specified',
      () => {
        cli = new CLI();
        assert.strictEqual(cli.stream, process.stderr);
      });
  });

  describe('methods', () => {
    beforeEach(() => {
      stream = new LogStream();
      cli = new CLI(stream);
    });

    describe('startSpinner', () => {
      beforeEach(() => {
        cli.startSpinner('foo');
      });

      it('should set the text and start the spinner', () => {
        assert.strictEqual(cli.spinner.text, 'foo');
      });
    });

    describe('updateSpinner', () => {
      it('should update the spinner text', () => {
        cli.updateSpinner('bar');
        assert.strictEqual(cli.spinner.text, 'bar');
      });
    });

    describe('stopSpinner', () => {
      it('should log the error symbol and the specified text', () => {
        cli.stopSpinner('error', cli.SPINNER_STATUS.FAILED);
        assert.strictEqual(stream.toString(), `${error}  error${EOL}`);
      });

      it('should log the success symbol and the specified text', () => {
        cli.stopSpinner('success');
        assert.strictEqual(stream.toString(), `${success}  success${EOL}`);
      });

      it('should log the warn symbol and the specified text', () => {
        cli.stopSpinner('warn', cli.SPINNER_STATUS.WARN);
        assert.strictEqual(stream.toString(), `${warning}  warn${EOL}`);
      });

      it('should log the info symbol and the specified text', () => {
        cli.stopSpinner('info', cli.SPINNER_STATUS.INFO);
        assert.strictEqual(stream.toString(), `${info}  info${EOL}`);
      });
    });

    describe('write', () => {
      it('should write in stream', () => {
        cli.write('Getting commits...');
        assert.strictEqual(stream.toString(), 'Getting commits...');
      });
    });

    describe('log', () => {
      it('should write in stream', () => {
        cli.log('Getting commits...');
        assert.strictEqual(stream.toString(), `Getting commits...${EOL}`);
      });
    });

    describe('table', () => {
      it('should print the first element with bold style and padding', () => {
        cli.table('Title', 'description');
        assert.strictEqual(stream.toString(),
          `${chalk.bold('Title   ')}description${EOL}`);
      });
    });

    describe('separator', () => {
      it('should print a separator line with the specified text', () => {
        cli.separator('Separator');
        assert.strictEqual(
          stream.toString(),
          '---------------------------------- ' + chalk.bold('Separator') +
            ' -----------------------------------' + EOL);
      });

      it('should print a separator line with a custom separator', () => {
        cli.separator('PR', 20, '+');
        assert.strictEqual(
          stream.toString(),
          '++++++++ ' + chalk.bold('PR') + ' ++++++++' + EOL);
      });

      it('should print a separator line without text', () => {
        cli.separator();
        assert.strictEqual(
          stream.toString(),
          '-------------------------------------------------------' +
            '-------------------------' + EOL);
      });
    });

    describe('ok', () => {
      it('should print a success message', () => {
        cli.ok('Perfect!');
        assert.strictEqual(stream.toString(), `${success}  Perfect!${EOL}`);
      });

      it('should print a success message in a new line if specified', () => {
        cli.ok('Perfect!', { newline: true });
        assert.strictEqual(stream.toString(),
          `${EOL}${success}  Perfect!${EOL}`);
      });
    });

    describe('warn', () => {
      it('should print a warning message', () => {
        cli.warn('Warning!');
        assert.strictEqual(stream.toString(), `${warning}  Warning!${EOL}`);
      });

      it('should print a warning message in a new line if specified', () => {
        cli.warn('Warning!', { newline: true });
        assert.strictEqual(stream.toString(),
          `${EOL}${warning}  Warning!${EOL}`);
      });
    });

    describe('info', () => {
      it('should print an info message', () => {
        cli.info('Info!');
        assert.strictEqual(stream.toString(), `${info}  Info!${EOL}`);
      });

      it('should print an info message in a new line if specified', () => {
        cli.info('Info!', { newline: true });
        assert.strictEqual(stream.toString(), `${EOL}${info}  Info!${EOL}`);
      });
    });

    // TODO: `Error` instance test
    describe('error', () => {
      it('should print an error message', () => {
        cli.error('Error!');
        assert.strictEqual(stream.toString(), `${error}  Error!${EOL}`);
      });

      it('should print an error message in a new line if specified', () => {
        cli.error('Error!', { newline: true });
        assert.strictEqual(stream.toString(), `${EOL}${error}  Error!${EOL}`);
      });
    });
  });
});
