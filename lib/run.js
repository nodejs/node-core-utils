'use strict';

const { spawn, spawnSync } = require('child_process');

const IGNORE = '__ignore__';

function runAsyncBase(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, Object.assign({
      cwd: process.cwd(),
      stdio: 'inherit'
    }, options.spawnArgs));
    child.on('close', (code) => {
      if (code !== 0) {
        const { ignoreFailure = true } = options;
        if (ignoreFailure) {
          return reject(new Error(IGNORE));
        }
        const err = new Error(`${cmd} failed: ${code}`);
        err.code = code;
        err.messageOnly = true;
        return reject(err);
      }
      return resolve();
    });
  });
}

exports.forceRunAsync = function(cmd, args, options) {
  return runAsyncBase(cmd, args, options).catch((error) => {
    if (error.message !== IGNORE) {
      if (!error.messageOnly) {
        console.error(error);
      }
      throw error;
    }
  });
};

exports.runPromise = function runAsync(promise) {
  return promise.catch((error) => {
    if (error.message !== IGNORE) {
      console.error(error);
    }
    exports.exit();
  });
};

exports.runAsync = function(cmd, args, options) {
  return exports.runPromise(runAsyncBase(cmd, args, options));
};

exports.runSync = function(cmd, args, options) {
  const child = spawnSync(cmd, args, Object.assign({
    cwd: process.cwd()
  }, options));
  if (child.error) {
    throw child.error;
  } else if (child.stderr.length) {
    throw new Error(child.stderr.toString());
  } else {
    return child.stdout.toString();
  }
};

exports.exit = function() {
  process.exit(1);
};

exports.IGNORE = IGNORE;
