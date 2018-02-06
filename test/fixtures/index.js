'use strict';

const fs = require('fs');
const path = require('path');

exports.readFile = function(filePath) {
  const file = path.resolve(__dirname, filePath);
  return fs.readFileSync(file, 'utf8');
};

exports.readJSON = function(filePath) {
  const file = exports.readFile(filePath);
  return JSON.parse(file);
};

exports.patchPrototype = function(arr, key, proto) {
  for (const item of arr) {
    Object.setPrototypeOf(item[key], proto);
  }
};

exports.path = function(file) {
  return path.resolve(__dirname, file);
};
