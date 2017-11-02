'use strict';

const pino = require('pino');
const chalk = require('chalk');
const { EOL } = require('os');

function paint(level) {
  switch (level) {
    case 'ERROR':
    case 'FATAL':
      return chalk.red(`[${level}]`);
    case 'WARN':
      return chalk.yellow(`[${level}]`);
    case 'INFO':
      return chalk.blue(`[${level}]`);
    default:
      return chalk.green(`[${level}]`);
  }
}

const LEVELS = new Map(Object.keys(pino.levels.values)
  .map((key) => [pino.levels.values[key], key.toUpperCase()]));

const prettyOptions = {
  forceColor: true,
  formatter(obj) {
    const level = LEVELS.get(obj.level);
    let timestamp = '';
    if (obj.showTime) {
      timestamp = `[${new Date(obj.time).toISOString()}] `;
    }
    if (level === 'ERROR') {
      return `${paint(level)} ${timestamp}${obj.type ? obj.type + ' ' : ''}` +
        `${obj.msg}${EOL}` +
        `[STACK] ${obj.stack || ''}${EOL}` +
        `[DATA] ${JSON.stringify(obj.data, null, 2) || ''}${EOL}`;
    } else if (level === 'INFO' && obj.raw) {
      return `${paint(level)} ${timestamp}${obj.msg || ''}${EOL}${obj.raw}`;
    } else {
      return `${paint(level)} ${timestamp}${obj.msg}`;
    }
  }
};

module.exports = function loggerFactory(stream) {
  const pretty = pino.pretty(prettyOptions);
  pretty.pipe(stream);
  const logger = pino({
    name: 'node-core-utils',
    safe: true,
    level: 'trace'
  }, pretty);
  return logger;
};
