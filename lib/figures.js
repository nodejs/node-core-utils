import { figures } from 'listr2';
import { styleText } from 'node:util';

export const warning = styleText('yellow', figures.warning);
export const error = styleText('red', figures.cross);
export const info = styleText('blue', figures.info);
export const success = styleText('green', figures.tick);
