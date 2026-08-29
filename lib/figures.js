import chalk from 'chalk';
import { figures } from 'listr2';

export const warning = chalk.yellow(figures.warning);
export const error = chalk.red(figures.cross);
export const info = chalk.blue(figures.pointer);
export const success = chalk.green(figures.tick);
