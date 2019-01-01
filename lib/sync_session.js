'use strict';

const Session = require('./session');

class SyncSession extends Session {
  constructor(cli, dir) {
    // eslint-disable-next-line no-useless-constructor
    super(cli, dir);
  }

  async sync() {
    if (this.warnForMissing()) {
      return;
    }
    if (this.warnForWrongBranch()) {
      return;
    }
    return this.tryResetHead();
  }
}

module.exports = SyncSession;
