const chalk = require('chalk');

exports.log = (title, ...args) => {
  args.unshift(chalk`{green ${title}}`);
  console.log.apply(null, args);
};

exports.error = (title, ...args) => {
  args.unshift(chalk`{red.bold ${title}}`);
  console.error.apply(null, args);
};
