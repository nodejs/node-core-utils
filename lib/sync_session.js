'use strict';

const Session = require('./session');

class SyncSession extends Session {
  // eslint-disable-next-line no-useless-constructor
  constructor(cli, dir) {
    super(cli, dir);
  }

  async sync() {
    if (this.warnForWrongBranch()) {
      return;
    }
    return this.tryResetHead();
  }
}

module.exports = SyncSession;
