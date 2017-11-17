'use strict';

const chalk = require('chalk');
const {
  tick, cross, info: infoRaw, warning: warningRaw
} = require('figures');

module.exports = {
  warning: chalk.yellow(warningRaw),
  error: chalk.red(cross),
  info: chalk.blue(infoRaw),
  success: chalk.green(tick)
};
