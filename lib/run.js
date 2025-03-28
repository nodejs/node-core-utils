import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  isDebugVerbosity,
  debuglog
} from './verbosity.js';

export const IGNORE = '__ignore__';

function runAsyncBase(cmd, args, {
  ignoreFailure = true,
  spawnArgs,
  input,
  captureStderr = false,
  captureStdout = false
} = {}) {
  if (cmd instanceof URL) {
    cmd = fileURLToPath(cmd);
  }
  let stdio = 'inherit';
  if (captureStderr || captureStdout || input != null) {
    stdio = [
      input == null ? 'inherit' : 'pipe',
      captureStdout ? 'pipe' : 'inherit',
      captureStderr ? 'pipe' : 'inherit'
    ];
  }
  return new Promise((resolve, reject) => {
    const opt = Object.assign({
      cwd: process.cwd(),
      stdio
    }, spawnArgs);
    if (isDebugVerbosity()) {
      debuglog('[Spawn]', `${cmd} ${(args || []).join(' ')}`, opt);
    }
    const child = spawn(cmd, args, opt);
    let stderr;
    if (!captureStdout && captureStderr) {
      stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    let stdout;
    if (captureStdout) {
      stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
    }
    child.on('error', reject);
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
      return resolve(stdout ?? stderr);
    });
    if (input != null) child.stdin.end(input);
  });
}

export function forceRunAsync(cmd, args, options) {
  return runAsyncBase(cmd, args, options).catch((error) => {
    if (error.message !== IGNORE) {
      if (!error.messageOnly) {
        console.error(error);
      }
      throw error;
    }
  });
};

export function runPromise(promise) {
  return promise.catch((error) => {
    if (error.message !== IGNORE) {
      console.error(error);
    }
    exit();
  });
};

export function runAsync(cmd, args, options) {
  return runPromise(runAsyncBase(cmd, args, options));
};

export function runSync(cmd, args, options) {
  if (cmd instanceof URL) {
    cmd = fileURLToPath(cmd);
  }
  const opt = Object.assign({
    cwd: process.cwd()
  }, options);
  if (isDebugVerbosity()) {
    debuglog('[SpawnSync]', `${cmd} ${(args || []).join(' ')}`, opt);
  }
  const child = spawnSync(cmd, args, opt);
  if (child.error) {
    throw child.error;
  } else if (child.status !== 0) {
    throw new Error(`${cmd} ${args} failed with stderr: ` +
                    child.stderr.toString());
  } else {
    return child.stdout.toString();
  }
};

export function exit() {
  process.exit(1);
};
