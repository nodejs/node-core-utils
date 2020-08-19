'use strict';

const { spawn, spawnSync } = require('child_process');

const IGNORE = '__ignore__';

function runAsyncBase(cmd, args, {
  ignoreFailure = true,
  spawnArgs,
  captureStdout = false
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, Object.assign({
      cwd: process.cwd(),
      stdio: captureStdout ? ['inherit', 'pipe', 'inherit'] : 'inherit'
    }, spawnArgs));
    let stdout;
    if (captureStdout) {
      stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
    }
    child.on('close', (code) => {
      if (code !== 0) {
        if (ignoreFailure) {
          return reject(new Error(IGNORE));
        }
        const err = new Error(`${cmd} ${args} failed: ${code}`);
        err.code = code;
        err.messageOnly = true;
        return reject(err);
      }
      if (captureStdout === 'lines') {
        stdout = stdout.split(/\r?\n/g);
        if (stdout[stdout.length - 1] === '') stdout.pop();
      }
      return resolve(stdout);
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
  } else if (child.status !== 0) {
    throw new Error(`${cmd} ${args} failed with stderr: ` +
                    child.stderr.toString());
  } else {
    return child.stdout.toString();
  }
};

exports.exit = function() {
  process.exit(1);
};

exports.IGNORE = IGNORE;
