'use strict';

const fs = require('fs');
const path = require('path');

exports.readFile = function(...args) {
  const file = path.resolve(__dirname, ...args);
  return fs.readFileSync(file, 'utf8');
};

exports.readJSON = function(...args) {
  const file = exports.readFile(...args);
  return JSON.parse(file);
};

exports.patchPrototype = function(arr, key, proto) {
  for (const item of arr) {
    Object.setPrototypeOf(item[key], proto);
  }
};

exports.path = function(...args) {
  return path.resolve(__dirname, ...args);
};
