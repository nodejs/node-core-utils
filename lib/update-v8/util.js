'use strict';

const fs = require('fs');

const constants = require('./constants');

exports.getNodeV8Version = function getNodeV8Version(cwd) {
  try {
    const v8VersionH = fs.readFileSync(
      `${cwd}/deps/v8/include/v8-version.h`,
      'utf8'
    );
    const major = parseInt(/V8_MAJOR_VERSION (\d+)/.exec(v8VersionH)[1], 10);
    const minor = parseInt(/V8_MINOR_VERSION (\d+)/.exec(v8VersionH)[1], 10);
    const build = parseInt(/V8_BUILD_NUMBER (\d+)/.exec(v8VersionH)[1], 10);
    const patch = parseInt(/V8_PATCH_LEVEL (\d+)/.exec(v8VersionH)[1], 10);
    if (patch === 0) return [major, minor, build];
    else return [major, minor, build, patch];
  } catch (e) {
    throw new Error('Could not find V8 version');
  }
};

exports.getV8Deps = function getV8Deps(version) {
  const major = version[0];
  const minor = version[1];
  const number = major * 10 + minor;
  return constants.v8Deps.filter(
    (dep) => dep.since <= number && (dep.until || Infinity) >= number
  );
};
