import path from 'node:path';

import _ from 'lodash';

import GitHubTree from '../github/tree.js';
import { writeFile, readJson, writeJson, readFile } from '../file.js';
import {
  shortSha
} from '../utils.js';

export class WPTUpdater {
  constructor(path, cli, request, nodedir, commit) {
    this.path = path;
    this.nodedir = nodedir;

    this.cli = cli;
    this.request = request;
    this.treeParams = {
      owner: 'web-platform-tests',
      repo: 'wpt',
      branch: 'master',
      path,
      commit
    };
    this.tree = new GitHubTree(cli, request, this.treeParams);
    this.assets = [];
  }

  templates(...args) {
    const file = path.posix.join('templates', ...args);
    return _.template(readFile(new URL(file, import.meta.url)));
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
    const content = await this.tree.buffer(filepath);
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
    let versions = this.getLocalVersions();

    this.cli.startSpinner('Updating versions.json ...');
    Object.assign(versions, updated);
    // Reorder keys alphabetically
    versions = Object.fromEntries(
      Object.entries(versions).sort(([key1], [key2]) =>
        key1.localeCompare(key2)
      )
    );
    writeJson(versionsPath, versions);
    this.cli.stopSpinner(`Updated ${versionsPath}`);

    const urlMap = Object.keys(versions).map(
      (key) => [key, this.getTreeUrl(versions[key].path, versions[key].commit)]
    );

    this.cli.startSpinner('Updating README ...');
    const readme = this.templates('README.md')({ map: urlMap });
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

    const rev = shortSha(localCommit);
    this.cli.log(`Last local update for ${key} is ${rev}`);
    this.cli.startSpinner('checking updates...');
    const lastCommit = await this.tree.getLastCommit();

    if (localCommit === lastCommit) {
      this.cli.stopSpinner(
        `${key} is up to date with upstream (${rev})`
      );
      return false;
    }

    const upstreamRev = shortSha(lastCommit);
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

export class ResourcesUpdater extends WPTUpdater {
  constructor(cli, request, nodedir, commit) {
    super('resources', cli, request, nodedir, commit);
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

export class InterfacesUpdater extends WPTUpdater {
  constructor(cli, request, nodedir, commit, supported) {
    super('interfaces', cli, request, nodedir, commit);
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
