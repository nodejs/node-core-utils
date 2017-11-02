'use strict';

const assert = require('assert');
const chalk = require('chalk');

const logger = require('../../lib/logger');
const captureStdout = require('../fixtures/capture_stdout');

// Complete ISO date format -> YYYY-MM-DDThh:mm:ss.sTZD
const dateRegex = new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/);

describe('Logger', () => {
  let stdout = null;

  // Capture the stdout output before each test
  // TODO(joyeecheung): should avoid monkey-patching Node internals
  // and get pino write to our own writable stream instead
  beforeEach(() => {
    stdout = captureStdout(process.stdout);
  });

  // Restore the stdout after each test here to let errors to be displayed
  afterEach(() => {
    stdout.restore();
  });

  describe('Colors', () => {
    it('should have blue color when the level is INFO', () => {
      logger.info('test');
      assert.equal(stdout.getBuffer(), `${chalk.blue('[INFO]')} test\n`);
      // It is necessary to restore here the stdout too because the `it()` output occurs before the afterEach function
      stdout.restore();
    });

    it('should have red color when the level is FATAL', () => {
      logger.fatal('test');
      assert.equal(stdout.getBuffer(), `${chalk.red('[FATAL]')} test\n`);
      stdout.restore();
    });

    it('should have yellow color when the level is WARN', () => {
      logger.warn('test');
      assert.equal(stdout.getBuffer(), `${chalk.yellow('[WARN]')} test\n`);
      stdout.restore();
    });

    it('should have green color when the level is DEBUG', () => {
      logger.debug('test');
      assert.equal(stdout.getBuffer(), `${chalk.green('[DEBUG]')} test\n`);
      stdout.restore();
    });
  });

  describe('Formatter', () => {
    it('should print the date and time when showTime is true ', () => {
      logger.info({ showTime: true }, 'test');
      const date = stdout.getBuffer().split(' ')[1].replace(/\[|\]/g, '');
      assert.equal(dateRegex.test(date), true);
      stdout.restore();
    });

    describe('ERROR', () => {
      it('should print STACK and DATA when the level is ERROR', () => {
        logger.error({
          type: 'test_error',
          stack: 'stack',
          data: { reason: 'Testing logger.error' }
        }, 'Error with logger.error');
        assert.equal(stdout.getBuffer(), `${chalk.red('[ERROR]')} test_error Error with logger.error\n[STACK] stack\n[DATA] {\n` +
          `  "reason": "Testing logger.error"\n` +
        `}\n\n`);
        stdout.restore();
      });

      it('should print nothing when there is no object to be serialized', () => {
        logger.error('test');
        assert.equal(stdout.getBuffer(), `${chalk.red('[ERROR]')} test\n[STACK] \n[DATA] \n\n`);
        stdout.restore();
      });
    });

    describe('INFO', () => {
      it('should print raw information when it is defined', () => {
        logger.info({ raw: 'Some interesting information' }, 'test');
        assert.equal(stdout.getBuffer(), `${chalk.blue('[INFO]')} test\nSome interesting information\n`);
        stdout.restore();
      });

      it('should not print message when msg is defined', () => {
        logger.info({ raw: 'Some interesting information' });
        assert.equal(stdout.getBuffer(), `${chalk.blue('[INFO]')} \nSome interesting information\n`);
        stdout.restore();
      });
    });
  });
});
