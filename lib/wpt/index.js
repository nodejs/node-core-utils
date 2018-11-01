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

  get versionsPath() {
    return this.fixtures('versions.json');
  }

  get readmePath() {
    return this.fixtures('README.md');
  }

  getLocalVersions() {
    return readJson(this.versionsPath);
  }

  // If filepath starts with '/', the path is relative to WPT project root,
  // otherwise it's relative to the path of this updater
  async pullTextFile(dest, filepath) {
    const content = await this.tree.text(filepath);
    const filename = path.join(dest, filepath);
    writeFile(filename, content);
    this.cli.updateSpinner(`Downloaded ${filename}`);
  }

  async getAssetList() {
    this.cli.startSpinner(`Querying asset list for ${this.path}...`);
    const assets = this.assets = await this.tree.getFiles();
    this.cli.stopSpinner(
      `Read asset list, ${assets.length} files in total.`
    );
    return assets;
  }

  async pullAllAssets(assets) {
    const fixtures = this.fixtures(this.path);
    this.cli.separator(`Writing assets to ${fixtures}...`);

    if (!assets) {
      assets = await this.getAssetList();
    }

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
    const versionsPath = this.versionsPath;
    const readmePath = this.readmePath;
    const versions = this.getLocalVersions();

    this.cli.startSpinner('Updating versions.json ...');
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

  async checkNeedsUpdate(key = this.path) {
    this.cli.separator(`Checking updates for ${key}...`);

    const versions = this.getLocalVersions();
    const localCommit = versions[key] && versions[key].commit;
    if (!localCommit) {
      this.cli.log(`No records for ${key} in local ${this.versionsPath}`);
      this.cli.log('pulling files from scratch...');
      return true;
    }

    const rev = localCommit.slice(0, 7);
    this.cli.log(`Last local update for ${key} is ${rev}`);
    this.cli.startSpinner('checking updates...');
    const lastCommit = await this.tree.getLastCommit();

    if (localCommit === lastCommit) {
      this.cli.stopSpinner(
        `${key} is up to date with upstream (${rev})`
      );
      return false;
    }

    const upstreamRev = lastCommit.slice(0, 7);
    this.cli.stopSpinner(`Last update in upstream is ${upstreamRev}`);
    return true;
  }

  async update() {
    const needsUpdate = await this.checkNeedsUpdate();
    if (!needsUpdate) {
      return;
    }
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

class ResourcesUpdater extends WPTUpdater {
  constructor(cli, request, nodedir) {
    super('resources', cli, request, nodedir);
  }

  async update() {  // override
    const needsUpdate = await this.checkNeedsUpdate();
    if (!needsUpdate) {
      return;
    }

    const assets = await this.getAssetList();
    const excludes = ['test/', 'chromium/', 'webidl2/test'];
    const toDownload = assets.filter(asset =>
      !excludes.find(prefix => asset.name.startsWith(prefix))
    );
    const excluded = assets.length - toDownload.length;
    this.cli.log(`Excluded ${excluded} files, ` +
                 `${toDownload.length} files to write.`);

    await this.pullAllAssets(toDownload);

    const lastCommit = this.tree.lastCommit;
    await this.updateVersions({
      [this.path]: {
        commit: lastCommit,
        path: this.path
      }
    });
  }
}

class InterfacesUpdater extends WPTUpdater {
  constructor(cli, request, nodedir, supported) {
    super('interfaces', cli, request, nodedir);
    this.supported = supported;
  }

  async update() {  // override
    const needsUpdate = await this.checkNeedsUpdate();
    if (!needsUpdate) {
      return;
    }
    const supported = this.supported;
    const assets = await this.getAssetList();
    const found = [];
    for (const mod of supported) {
      const idl = `${mod}.idl`;
      const asset = assets.find(asset => asset.name === idl);
      if (asset) {
        found.push(asset);
      } else {
        this.cli.warn(`Couldn't find ${idl} in the upstream`);
      }
    }

    await this.pullAllAssets(found);

    const lastCommit = this.tree.lastCommit;
    await this.updateVersions({
      [this.path]: {
        commit: lastCommit,
        path: this.path
      }
    });
  }
}

module.exports = {
  WPTUpdater,
  ResourcesUpdater,
  InterfacesUpdater
};
