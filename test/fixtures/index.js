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
