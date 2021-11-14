'use strict';

const {
  promises: {
    appendFile,
    readFile,
    writeFile,
    rm,
    rmdir
  }
} = require('fs');
const path = require('path');

async function getNodeV8Version(cwd) {
  try {
    const v8VersionH = await readFile(
      `${cwd}/deps/v8/include/v8-version.h`,
      'utf8'
    );
    const major = parseInt(/V8_MAJOR_VERSION (\d+)/.exec(v8VersionH)[1], 10);
    const minor = parseInt(/V8_MINOR_VERSION (\d+)/.exec(v8VersionH)[1], 10);
    const build = parseInt(/V8_BUILD_NUMBER (\d+)/.exec(v8VersionH)[1], 10);
    const patch = parseInt(/V8_PATCH_LEVEL (\d+)/.exec(v8VersionH)[1], 10);
    return {
      major,
      minor,
      build,
      patch,
      majorMinor: major * 10 + minor,
      toString() {
        return this.patch
          ? `${this.major}.${this.minor}.${this.build}.${this.patch}`
          : `${this.major}.${this.minor}.${this.build}`;
      }
    };
  } catch (e) {
    throw new Error('Could not find V8 version');
  }
};

function filterForVersion(list, version) {
  return list.filter((dep) => {
    return dep.since <= version.majorMinor &&
      (dep.until || Infinity) >= version.majorMinor;
  });
}

async function addToGitignore(nodeDir, value) {
  const gitignorePath = path.join(nodeDir, 'deps/v8/.gitignore');
  await appendFile(gitignorePath, `${value}\n`);
}

async function replaceGitignore(nodeDir, options) {
  const gitignorePath = path.join(nodeDir, 'deps/v8/.gitignore');
  let gitignore = await readFile(gitignorePath, 'utf8');
  gitignore = gitignore.replace(options.match, options.replace);
  await writeFile(gitignorePath, gitignore);
}

function removeDirectory(path) {
  if (typeof rm !== 'undefined') {
    return rm(path, { recursive: true, force: true });
  } else {
    // Node.js 12 doesn't have `rm`, and `rmdir` emits a deprecation warning in
    // Node.js 16+.
    return rmdir(path, { recursive: true });
  }
}

module.exports = {
  getNodeV8Version,
  filterForVersion,
  addToGitignore,
  replaceGitignore,
  removeDirectory
};
