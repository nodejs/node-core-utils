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
    if (patch === 0) return [major, minor, build];
    else return [major, minor, build, patch];
  } catch (e) {
    throw new Error('Could not find V8 version');
  }
};

function filterForVersion(list, version) {
  const major = version[0];
  const minor = version[1];
  const number = major * 10 + minor;
  return list.filter(
    (dep) => dep.since <= number && (dep.until || Infinity) >= number
  );
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
