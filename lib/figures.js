import chalk from 'chalk';
import figures from 'figures';

export const warning = chalk.yellow(figures.warning);
export const error = chalk.red(figures.cross);
export const info = chalk.blue(figures.info);
export const success = chalk.green(figures.tick);
