import fs from 'node:fs';
import path from 'node:path';

export function appendFile(file, content) {
  const parts = path.parse(file);
  if (!fs.existsSync(parts.dir)) {
    fs.mkdirSync(parts.dir, { recursive: true });
  }
  // TODO(joyeecheung): what if the file is a dir?
  fs.appendFileSync(file, content, 'utf8');
};

export function writeFile(file, content) {
  const parts = path.parse(file);
  if (parts.dir !== '' && !fs.existsSync(parts.dir)) {
    fs.mkdirSync(parts.dir, { recursive: true });
  }
  // TODO(joyeecheung): what if the file is a dir?
  fs.writeFileSync(file, content, 'utf8');
};

export function writeJson(file, obj) {
  writeFile(file, `${JSON.stringify(obj, null, 2)}\n`);
};

export function readFile(file) {
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8');
  }
  return '';
};

export function readJson(file) {
  const content = readFile(file);
  if (content) {
    return JSON.parse(content);
  }
  return {};
};
