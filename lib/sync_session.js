import Session from './session.js';

export default class SyncSession extends Session {
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
