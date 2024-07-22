import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const tmpdirPath = fileURLToPath(new URL('tmp', import.meta.url));

export const tmpdir = {
  get path() {
    return tmpdirPath;
  },
  refresh() {
    fs.rmSync(this.path, { recursive: true, force: true });
    fs.mkdirSync(this.path, { recursive: true });
  }
};

export function copyShallow(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const list = fs.readdirSync(src);
  for (const file of list) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

export function raw(obj) {
  return JSON.parse(JSON.stringify(obj));
}
