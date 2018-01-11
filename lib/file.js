'use strict';

const fs = require('fs');

exports.writeFile = function(file, content) {
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
