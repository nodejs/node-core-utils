'use strict';

const pino = require('pino');
const chalk = require('chalk');

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
const pretty = pino.pretty({
  forceColor: true,
  formatter(obj) {
    const level = LEVELS.get(obj.level);
    let timestamp = '';
    if (obj.showTime) {
      timestamp = `[${new Date(obj.time).toISOString()}] `;
    }
    if (level === 'ERROR') {
      return `${paint(level)} ${timestamp}${obj.type ? obj.type + ' ' : ''}${obj.msg}\n` +
             `[STACK] ${obj.stack || ''}\n` +
             `[DATA] ${JSON.stringify(obj.data, null, 2) || ''}\n`;
    } else if (level === 'INFO' && obj.raw) {
      return `${paint(level)} ${timestamp}${obj.msg || ''}\n${obj.raw}`;
    } else {
      return `${paint(level)} ${timestamp}${obj.msg}`;
    }
  }
});

pretty.pipe(process.stdout);
const logger = pino({
  name: 'node-core-utils',
  safe: true,
  level: 'trace'
}, pretty);

module.exports = logger;
