'use strict';

exports.ascending = function(a, b) {
  return a < b ? -1 : 1;
};

exports.descending = function(a, b) {
  return a > b ? -1 : 1;
};

function flatten(arr) {
  let result = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      result = result.concat(flatten(item));
    } else {
      result.push(item);
    }
  }
  return result;
}
exports.flatten = flatten;
