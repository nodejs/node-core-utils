'use strict';

const path = require('path');
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const fs = require('fs');

exports.tmpdir = {
  get path() {
    return path.join(__dirname, 'tmp');
  },
  refresh() {
    rimraf.sync(this.path);
    mkdirp.sync(this.path);
  }
};

exports.copyShallow = function(src, dest) {
  mkdirp.sync(dest);
  const list = fs.readdirSync(src);
  for (const file of list) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
};

exports.raw = function(obj) {
  return JSON.parse(JSON.stringify(obj));
};
