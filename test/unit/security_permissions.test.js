import { describe, it } from 'node:test';
import assert from 'node:assert';

import { confirmSecurityStep } from '../../lib/security-release/security-release.js';

describe('security release permissions', () => {
  it('asks permission for an individual step and defaults to no', async() => {
    const cli = {
      promptCalls: [],
      prompt(message, options) {
        this.promptCalls.push([message, options]);
        return true;
      }
    };

    await confirmSecurityStep(
      cli,
      'run `git push -u origin next-security-release`',
      'This pushes the security release branch.'
    );

    assert.deepStrictEqual(cli.promptCalls, [[
      'Allow action: run `git push -u origin next-security-release`?\n\n' +
        'This pushes the security release branch.',
      { defaultAnswer: false }
    ]]);
  });

  it('aborts when an individual step is denied', async() => {
    const cli = {
      prompt() {
        return false;
      }
    };

    await assert.rejects(() => confirmSecurityStep(
      cli,
      'write `security-release/next-security-release/vulnerabilities.json`',
      'This writes vulnerabilities.json.'
    ), /Aborted: write `security-release\/next-security-release\/vulnerabilities\.json`\./);
  });
});
