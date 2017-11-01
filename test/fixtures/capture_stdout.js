'use strict';

// Capture and obtain the process.stdout, used to test the logger
const captureStdout = (stream) => {
  let originalWriteFn = stream.write;
  let buffer = '';
  stream.write = (chunk, encoding, callback) => {
    buffer += chunk.toString();
  };

  return {
    getBuffer: () => {
      return buffer;
    },
    restore: () => {
      stream.write = originalWriteFn;
    }
  };
};

module.exports = captureStdout;
