import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import CLI from '../../lib/cli.js';
import * as figures from '../../lib/figures.js';

import LogStream from '../fixtures/log_stream.js';

function strip(text) {
  // eslint-disable-next-line
  return text.replace(/\u001b\[.*?m/g, '');
}

const warning = strip(figures.warning);
const error = strip(figures.error);
const info = strip(figures.info);
const success = strip(figures.success);

describe('cli', () => {
  let cli = null;
  let stream = null;

  const logResult = () => strip(stream.toString());

  describe('instantiation', () => {
    it('should set `process.stderr` as stream if no stream is specified',
      () => {
        cli = new CLI();
        assert.strictEqual(cli.stream, process.stderr);

        cli.setFigureIndent(2);
        assert.strictEqual(cli.figureIndent, '  ');
      });
  });

  describe('methods', () => {
    beforeEach(() => {
      stream = new LogStream();
      cli = new CLI(stream);
    });

    describe('spinners', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
        cli.startSpinner('foo');
      });

      it('should set the text and start the spinner', () => {
        assert.strictEqual(cli.spinner.text, 'foo');
      });

      it('should update the spinner text', () => {
        cli.updateSpinner('bar');
        assert.strictEqual(cli.spinner.text, 'bar');
      });

      afterEach(() => {
        cli.stopSpinner('stop', 'info');
      });
    });

    describe('write', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
      });
      it('should write in stream', () => {
        const stream = new LogStream();
        const cli = new CLI(stream);
        cli.write('Getting commits...');
        assert.strictEqual(strip(stream.toString()), 'Getting commits...');
      });
    });

    describe('log', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
      });
      it('should write in stream', () => {
        cli.log('Getting commits...');
        assert.strictEqual(logResult(), 'Getting commits...\n');
      });
    });

    describe('table', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
      });
      it('should print the first element with bold style and padding', () => {
        cli.table('Title', 'description');
        assert.strictEqual(logResult(),
          'Title      description\n');
      });
    });

    describe('separator', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
      });
      it('should print a separator line with the specified text', () => {
        cli.separator('Separator');
        assert.strictEqual(
          logResult(),
          '---------------------------------- Separator' +
            ' -----------------------------------\n');
      });

      it('should print a separator line with a custom separator', () => {
        cli.separator('PR', 20, '+');
        assert.strictEqual(
          logResult(),
          '++++++++ PR ++++++++\n');
      });

      it('should print a separator line without text', () => {
        cli.separator();
        assert.strictEqual(
          logResult(),
          '-------------------------------------------------------' +
            '-------------------------\n');
      });
    });

    describe('ok', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
      });
      it('should print a success message', () => {
        cli.ok('Perfect!');
        assert.strictEqual(logResult(), `   ${success}  Perfect!\n`);
      });

      it('should print a success message in a new line if specified', () => {
        cli.ok('Perfect!', { newline: true });
        assert.strictEqual(logResult(),
          `\n   ${success}  Perfect!\n`);
      });
    });

    describe('warn', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
      });
      it('should print a warning message', () => {
        cli.warn('Warning!');
        assert.strictEqual(logResult(), `   ${warning}  Warning!\n`);
      });

      it('should print a warning message in a new line if specified', () => {
        cli.warn('Warning!', { newline: true });
        assert.strictEqual(logResult(),
          `\n   ${warning}  Warning!\n`);
      });
    });

    describe('info', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
      });
      it('should print an info message', () => {
        cli.info('Info!');
        assert.strictEqual(logResult(), `   ${info}  Info!\n`);
      });

      it('should print an info message in a new line if specified', () => {
        cli.info('Info!', { newline: true });
        assert.strictEqual(logResult(), `\n   ${info}  Info!\n`);
      });
    });

    describe('error', () => {
      beforeEach(() => {
        stream = new LogStream();
        cli = new CLI(stream);
      });
      it('should print an error message', () => {
        cli.error('Error!');
        assert.strictEqual(logResult(), `   ${error}  Error!\n`);
      });

      it('should print an error message in a new line if specified', () => {
        cli.error('Error!', { newline: true });
        assert.strictEqual(logResult(), `\n   ${error}  Error!\n`);
      });

      it('should print an error message', () => {
        cli.error(new Error('Error!'));
        assert.ok(logResult().startsWith(`   ${error}  Error!\n`));
      });

      it('should print an error message in a new line if specified', () => {
        cli.error(new Error('Error!'), { newline: true });
        assert.ok(logResult().startsWith(`\n   ${error}  Error!\n`));
      });
    });
  });

  describe('prompt cares about spinner', () => {
    beforeEach(() => {
      stream = new LogStream();
      cli = new CLI(stream, {
        spinner: { isEnabled: true }
      });
      cli.setAssumeYes();
    });

    it('pauses when prompt a question', async() => {
      cli.startSpinner('foo');
      assert.deepEqual(cli.spinner.text, 'foo');
      assert.deepEqual(cli.spinner.isSpinning, true);
      await cli.prompt('So you think darkness is your ally?', {
        defaultAnswer: 'Yes, I was born in it. Molded by it.',
        questionType: cli.QUESTION_TYPE.INPUT
      });
      assert.strictEqual(cli.spinner.isSpinning, true);
      cli.stopSpinner('foo');
    });
  });

  describe('prompt assume yes', () => {
    beforeEach(() => {
      stream = new LogStream();
      cli = new CLI(stream);
      cli.setAssumeYes();
    });

    it('rejects when no default answer is provided for \'input\' type', () => {
      return assert.rejects(async() => {
        await cli.prompt('What is your favorite color', {
          questionType: cli.QUESTION_TYPE.INPUT
        });
      }, /defaultAnswer must be provided for non-confirmation prompts/);
    });

    it('rejects when no default answer is provided for \'number\' type', () => {
      return assert.rejects(async() => {
        await cli.prompt('Pick a number from 1-10', {
          questionType: cli.QUESTION_TYPE.NUMBER
        });
      }, /defaultAnswer must be provided for non-confirmation prompts/);
    });

    it('should return the default answer for an \'input\' type', async() => {
      assert.strictEqual(await cli.prompt('What is your favorite color', {
        defaultAnswer: 'blue',
        questionType: cli.QUESTION_TYPE.INPUT
      }), 'blue');
    });

    it('should return the default answer for a \'number\' type', async() => {
      assert.strictEqual(await cli.prompt('Pick a number from 1-10', {
        defaultAnswer: 10,
        questionType: cli.QUESTION_TYPE.NUMBER
      }), 10);
    });

    it('should return true if no default is given', async() => {
      assert.strictEqual(await cli.prompt('Question?'), true);
    });

    it('should return true if default is set to true', async() => {
      assert.strictEqual(await cli.prompt('Question?', {
        defaultAnswer: true
      }), true);
    });

    it('should return false if default is set to false', async() => {
      assert.strictEqual(await cli.prompt('Question?', {
        defaultAnswer: false
      }), false);
    });
  });
});
