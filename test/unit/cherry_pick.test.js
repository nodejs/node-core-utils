import { describe, it } from 'node:test';
import assert from 'node:assert';

import CherryPick from '../../lib/cherry_pick.js';

function stubCli() {
  return {
    warn() {},
    ok() {},
    log() {},
    async prompt() { return 'CVE-2026-XXXXX'; }
  };
}

describe('CherryPick: prototype wiring', () => {
  // `amend()` is borrowed from LandingSession and calls
  // `this.generateAmendedMessage()`, so it must be borrowed too.
  for (const method of [
    'downloadAndPatch',
    'validateLint',
    'getMessagePath',
    'saveMessage',
    'generateAmendedMessage'
  ]) {
    it(`borrows ${method} from LandingSession`, () => {
      assert.strictEqual(typeof CherryPick.prototype[method], 'function');
    });
  }
});

describe('CherryPick: generateAmendedMessage', () => {
  it('adds the CVE-ID trailer from cveIds during a security cherry-pick', async() => {
    const cp = new CherryPick(896, process.cwd(), stubCli(), {
      owner: 'nodejs-private',
      repo: 'node-private',
      includeCVE: true,
      cveIds: ['CVE-2026-58044']
    });
    cp.metadata = 'PR-URL: https://github.com/nodejs-private/node-private/pull/896\n' +
      'Reviewed-By: Robert Nagy <ronagy@icloud.com>';

    const original = 'sqlite: invalidate tag store iterators on statement reset\n\n' +
      'PR-URL: https://github.com/nodejs/node/pull/123';

    const amended = await cp.generateAmendedMessage(original);
    assert.match(amended, /CVE-ID: CVE-2026-58044/);
  });
});
