'use strict';

const which = require('which');
const { forceRunAsync } = require('./run');

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

let isGhAvailableCache;
exports.isGhAvailable = function isGhAvailable() {
  if (isGhAvailableCache === undefined) {
    isGhAvailableCache = which.sync('gh', { nothrow: true }) !== null;
  }
  return isGhAvailableCache;
};

/**
 * Returns the user's preferred text editor command.
 * @param {object} [options]
 * @param {boolean} [options.git] - Whether to try the GIT_EDITOR environment
 * variable or `git config`.
 * @returns {string|null}
 */
exports.getEditor = async function getEditor(options = {}) {
  const {
    git = false
  } = options;

  if (git) {
    if (process.env.GIT_EDITOR) {
      return process.env.GIT_EDITOR;
    }
    const out = await forceRunAsync(
      'git',
      ['config', 'core.editor'],
      { captureStdout: 'lines' }
    );
    if (out && out[0]) {
      return out[0];
    }
  }

  return process.env.VISUAL || process.env.EDITOR || null;
};
