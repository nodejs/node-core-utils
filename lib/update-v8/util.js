'use strict';

const fs = require('fs-extra');
const path = require('path');

function getNodeV8Version(cwd) {
  try {
    const v8VersionH = fs.readFileSync(
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
  await fs.appendFile(gitignorePath, `${value}\n`);
}

async function replaceGitignore(nodeDir, options) {
  const gitignorePath = path.join(nodeDir, 'deps/v8/.gitignore');
  let gitignore = await fs.readFile(gitignorePath, 'utf8');
  gitignore = gitignore.replace(options.match, options.replace);
  await fs.writeFile(gitignorePath, gitignore);
}

module.exports = {
  getNodeV8Version,
  filterForVersion,
  addToGitignore,
  replaceGitignore
};
