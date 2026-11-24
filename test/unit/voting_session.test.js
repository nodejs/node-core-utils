import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { clearCachedConfig } from '../../lib/config.js';
import Request from '../../lib/request.js';
import VotingSession from '../../lib/voting_session.js';
import TestCLI from '../fixtures/test_cli.js';

describe('VotingSession', () => {
  it('stops spinner as failed when vote.yml fetch returns non-ok HTTP status', async(t) => {
    const cli = new TestCLI();
    const hasXdg = Object.hasOwn(process.env, 'XDG_CONFIG_HOME');
    const origXdg = process.env.XDG_CONFIG_HOME;
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ncu-vote-'));
    t.after(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    const xdgDir = path.join(tmpDir, 'xdg');
    mkdirSync(xdgDir);
    process.env.XDG_CONFIG_HOME = xdgDir;
    clearCachedConfig();

    const request = Object.assign(Object.create(Request.prototype), {
      credentials: { github: 'dGVzdDp0b2tlbg==' },
      proxyAgent: undefined
    });
    let cancelled = false;
    request.fetch = async() => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: {
        cancel: async() => {
          cancelled = true;
        }
      },
      text: async() => '<html>503</html>'
    });

    try {
      const session = new VotingSession(cli, request, tmpDir, {
        owner: 'nodejs',
        repo: 'TSC',
        prid: 12344
      });
      await assert.rejects(
        () => session.decryptKeyPart({
          headRef: { name: 'vote-123' },
          commits: { nodes: [{ commit: { oid: '0123456789abcdef' } }] }
        }),
        /Unable to fetch .*: 503 Service Unavailable/);
      assert.strictEqual(cancelled, true);
      cli.assertCalledWith({
        startSpinner: [['Downloading vote file from remote...']],
        stopSpinner: [['Failed to download vote file', cli.SPINNER_STATUS.FAILED]]
      });
    } finally {
      if (hasXdg) {
        process.env.XDG_CONFIG_HOME = origXdg;
      } else {
        delete process.env.XDG_CONFIG_HOME;
      }
      clearCachedConfig();
    }
  });
});
