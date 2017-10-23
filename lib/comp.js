'use strict';

exports.ascending = function(a, b) {
  return a < b ? -1 : 1;
};

exports.descending = function(a, b) {
  return a > b ? -1 : 1;
};
