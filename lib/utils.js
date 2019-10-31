'use strict';

exports.ascending = function(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

exports.descending = function(a, b) {
  if (a === b) return 0;
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

exports.shortSha = function shortSha(sha) {
  return sha.slice(0, 12);
};
