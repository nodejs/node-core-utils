'use strict';

const fs = require('fs');
const path = require('path');

exports.appendFile = function(file, content) {
  const parts = path.parse(file);
  if (!fs.existsSync(parts.dir)) {
    fs.mkdirSync(parts.dir, { recursive: true });
  }
  // TODO(joyeecheung): what if the file is a dir?
  fs.appendFileSync(file, content, 'utf8');
};

exports.writeFile = function(file, content) {
  const parts = path.parse(file);
  if (parts.dir !== '' && !fs.existsSync(parts.dir)) {
    fs.mkdirSync(parts.dir, { recursive: true });
  }
  // TODO(joyeecheung): what if the file is a dir?
  fs.writeFileSync(file, content, 'utf8');
};

exports.writeJson = function(file, obj) {
  exports.writeFile(file, JSON.stringify(obj, null, 2));
};

exports.readFile = function(file) {
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8');
  }
  return '';
};

exports.readJson = function(file) {
  const content = exports.readFile(file);
  if (content) {
    return JSON.parse(content);
  }
  return {};
};
