'use strict';

const {
  WPTUpdater
} = require('./');

class HarnessUpdater extends WPTUpdater {
  constructor(cli, request, nodedir) {
    super('resources', cli, request, nodedir);
  }

  async update() {
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

module.exports = HarnessUpdater;
