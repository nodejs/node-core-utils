'use strict';

const path = require('path');
const rimraf = require('rimraf');
const fs = require('fs');

exports.tmpdir = {
  get path() {
    return path.join(__dirname, 'tmp');
  },
  refresh() {
    rimraf.sync(this.path);
    fs.mkdirSync(this.path, { recursive: true });
  }
};

exports.copyShallow = function(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const list = fs.readdirSync(src);
  for (const file of list) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
};

exports.raw = function(obj) {
  return JSON.parse(JSON.stringify(obj));
};
