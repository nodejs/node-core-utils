'use strict';

const GitHubTree = require('../github/tree');
const path = require('path');
const { writeFile, readJson, writeJson, readFile } = require('../file');
const _ = require('lodash');

class WPTUpdater {
  constructor(path, cli, request, nodedir) {
    this.path = path;
    this.nodedir = nodedir;

    this.cli = cli;
    this.request = request;
    this.treeParams = {
      owner: 'web-platform-tests',
      repo: 'wpt',
      branch: 'master',
      path
    };
    this.tree = new GitHubTree(cli, request, this.treeParams);
    this.assets = [];
  }

  templates(...args) {
    return _.template(readFile(path.join(__dirname, 'templates', ...args)));
  }

  fixtures(...args) {
    return path.join(this.nodedir, 'test', 'fixtures', 'wpt', ...args);
  }

  // If filepath starts with '/', the path is relative to WPT project root,
  // otherwise it's relative to the path of this updater
  async pullTextFile(dest, filepath) {
    const content = await this.tree.text(filepath);
    const filename = path.join(dest, filepath);
    writeFile(filename, content);
    this.cli.updateSpinner(`Downloaded ${filename}`);
  }

  async pullAllAssets() {
    const fixtures = this.fixtures(this.path);
    this.cli.separator(`Writing test fixtures to ${fixtures}...`);

    this.cli.startSpinner('Querying asset list...');
    const assets = this.assets = await this.tree.getFiles();
    this.cli.stopSpinner(
      `Downloaded asset list, ${assets.length} files to write.`
    );

    this.cli.startSpinner('Pulling assets...');
    await Promise.all(assets.map(
      (asset) => this.pullTextFile(fixtures, asset.name)
    ));
    this.cli.stopSpinner(`Downloaded ${assets.length} assets.`);

    return assets;
  }

  getTreeUrl(path, commit) {
    const params = Object.assign({}, this.treeParams, { commit, path });
    const tree = new GitHubTree(this.cli, this.request, params);
    return tree.getPermanentUrl();
  }

  /**
   * @param {string} nodedir
   * @param {Object<string, {commit: string, path: string}>} updated
   */
  async updateVersions(updated) {
    const versionsPath = this.fixtures('versions.json');
    const readmePath = this.fixtures('README.md');

    this.cli.startSpinner('Updating versions.json ...');
    const versions = readJson(versionsPath);
    Object.assign(versions, updated);
    writeJson(versionsPath, versions);
    this.cli.stopSpinner(`Updated ${versionsPath}`);

    const urlMap = Object.keys(versions).map(
      (key) => [key, this.getTreeUrl(versions[key].path, versions[key].commit)]
    );

    this.cli.startSpinner('Updating README ...');
    const readme = this.templates('README.md')({map: urlMap});
    writeFile(readmePath, readme);
    this.cli.stopSpinner(`Updated ${readmePath}`);
  }

  async updateLicense() {
    this.cli.startSpinner('Updating license...');
    await this.pullTextFile(this.fixtures(), '/LICENSE.md');
    this.cli.stopSpinner(`Updated ${this.fixtures('LICENSE.md')}.`);
  }

  async update() {
    await this.pullAllAssets();
    const lastCommit = await this.tree.getLastCommit();
    await this.updateVersions({
      [this.path]: {
        commit: lastCommit,
        path: this.path
      }
    });
  }
}

class HarnessUpdater extends WPTUpdater {
  constructor(cli, request, nodedir) {
    super('resources', cli, request, nodedir);
  }

  async update() {  // override
    const harnessPath = this.fixtures(this.path, 'testharness.js');
    this.cli.startSpinner(`Downloading ${harnessPath}...`);
    await this.pullTextFile(this.fixtures(this.path), 'testharness.js');
    this.cli.stopSpinner(`Downloaded ${harnessPath}`);
    const lastCommit = this.tree.lastCommit;
    await this.updateVersions({
      harness: { commit: lastCommit, path: 'resources' }
    });
  }
}

module.exports = {
  WPTUpdater,
  HarnessUpdater
};
