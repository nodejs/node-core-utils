'use strict';

const pino = require('pino');
const chalk = require('chalk');
const { EOL } = require('os');

function paint(label) {
  switch (label) {
    case 'ERROR':
    case 'STACK':
    case 'DATA':
    case 'FATAL':
      return chalk.red(`[${label}]`);
    case 'WARN':
      return chalk.yellow(`[${label}]`);
    case 'INFO':
      return chalk.blue(`[${label}]`);
    default:
      return chalk.green(`[${label}]`);
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
      let data;
      if (obj.data !== undefined) {
        data = JSON.stringify(obj.data, null, 2).replace(/\n/g, EOL);
      }
      return `${paint(level)} ${timestamp}${obj.type ? obj.type + ' ' : ''}` +
        `${obj.msg}${EOL}` +
        `${paint('STACK')} ${obj.stack || ''}${EOL}` +
        `${paint('DATA')} ${data || ''}${EOL}`;
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
