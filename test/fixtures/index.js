import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

export function readFile(...args) {
  const file = nodePath.join(__dirname, ...args);
  return fs.readFileSync(file, 'utf8');
};

export function readJSON(...args) {
  const file = readFile(...args);
  return JSON.parse(file);
};

export function patchPrototype(arr, key, proto) {
  for (const item of arr) {
    Object.setPrototypeOf(item[key], proto);
  }
};

export function path(...args) {
  return nodePath.join(__dirname, ...args);
};
