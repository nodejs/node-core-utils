'use strict';

const assert = require('assert');
const chalk = require('chalk');
const { EOL } = require('os');
const loggerFactory = require('../../lib/logger');
const LogStream = require('../fixtures/log_stream');

// Complete ISO date format -> YYYY-MM-DDThh:mm:ss.sTZD
const dateRegex = new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/);

describe('Logger', () => {
  describe('Colors', () => {
    let stream;
    let logger;

    beforeEach(() => {
      stream = new LogStream();
      logger = loggerFactory(stream);
    });

    it('should have blue color when the level is INFO', () => {
      logger.info('test');
      assert.strictEqual(stream.toString(),
        `${chalk.blue('[INFO]')} test${EOL}`);
    });

    it('should have red color when the level is FATAL', () => {
      logger.fatal('test');
      assert.strictEqual(stream.toString(),
        `${chalk.red('[FATAL]')} test${EOL}`);
    });

    it('should have yellow color when the level is WARN', () => {
      logger.warn('test');
      assert.strictEqual(stream.toString(),
        `${chalk.yellow('[WARN]')} test${EOL}`);
    });

    it('should have green color when the level is DEBUG', () => {
      logger.debug('test');
      assert.strictEqual(stream.toString(),
        `${chalk.green('[DEBUG]')} test${EOL}`);
    });
  });

  describe('Formatter', () => {
    let stream;
    let logger;

    beforeEach(() => {
      stream = new LogStream();
      logger = loggerFactory(stream);
    });

    it('should print the date and time when showTime is true ', () => {
      logger.info({ showTime: true }, 'test');
      const date = stream.toString().split(' ')[1].replace(/\[|\]/g, '');
      assert.strictEqual(dateRegex.test(date), true);
    });

    describe('ERROR', () => {
      it('should print STACK and DATA when the level is ERROR', () => {
        logger.error({
          type: 'test_error',
          stack: 'stack',
          data: { reason: 'Testing logger.error' }
        }, 'Error with logger.error');
        assert.strictEqual(stream.toString(),
          `${chalk.red('[ERROR]')} test_error Error with logger.error${EOL}` +
          `[STACK] stack${EOL}[DATA] {${EOL}` +
          `  "reason": "Testing logger.error"${EOL}` +
        `}${EOL}${EOL}`);
      });

      it('should print nothing when there is no object to be serialized', () => {
        logger.error('test');
        assert.strictEqual(stream.toString(),
          `${chalk.red('[ERROR]')} test${EOL}` +
          `[STACK] ${EOL}[DATA] ${EOL}${EOL}`);
      });
    });

    describe('INFO', () => {
      let stream;
      let logger;

      beforeEach(() => {
        stream = new LogStream();
        logger = loggerFactory(stream);
      });

      it('should print raw information when it is defined', () => {
        logger.info({ raw: 'Some interesting information' }, 'test');
        assert.strictEqual(stream.toString(),
          `${chalk.blue('[INFO]')} test${EOL}` +
          `Some interesting information${EOL}`);
      });

      it('should not print message when msg is defined', () => {
        logger.info({ raw: 'Some interesting information' });
        assert.strictEqual(stream.toString(),
          `${chalk.blue('[INFO]')} ${EOL}` +
          `Some interesting information${EOL}`);
      });
    });
  });
});
