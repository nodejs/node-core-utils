'use strict';

const { TestBuild } = require('./test_build');
const { PR_TREE } = require('../jenkins_constants');

class DailyBuild extends TestBuild {
  constructor(cli, request, id) {
    const path = `job/node-daily-master/${id}/`;
    const tree = PR_TREE;
    super(cli, request, path, tree);

    this.commitBuild = null;
  }

  formatAsMarkdown() {
    if (!this.commitBuild) {
      let result = 'Failed to trigger node-daily-master';
      if (this.builtOn) {
        result += ` on ${this.builtOn}`;
      }
      result += `\n\nURL: ${this.jobUrl}`;
      return result;
    }
    return super.formatAsMarkdown();
  }
}

module.exports = { DailyBuild };
