/* eslint-disable import/no-named-as-default-member */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import TestCLI from '../fixtures/test_cli.js';
import sinon from 'sinon';

import { WPTUpdater } from '../../lib/wpt/index.js';

describe('WPTUpdater', function() {
  const UNKNOWN_PATH = 'unknown path';
  let request;
  let wptUpdater;
  let nodedir;
  let cli;
  let path;
  const emptyData = {
    repository:
    {
      ref: { target: { history: { nodes: [] } } }
    }
  };

  before(() => {
    cli = new TestCLI();
    request = {
      gql: sinon.stub()
    };
    nodedir = '.';
    path = UNKNOWN_PATH;
    request.gql.withArgs(
      'LastCommit',
      {
        owner: 'web-platform-tests',
        repo: 'wpt',
        branch: 'master',
        path: UNKNOWN_PATH
      }
    ).returns(Promise.resolve(emptyData));
  });

  after(() => {
    cli.clearCalls();
  });

  it('rejects unsafe WPT names before making requests', () => {
    const unsafeNames = [
      '../', '', '.', '..', '../outside', '../../..',
      'url/..', 'url/../outside', 'url/./resources',
      '/url', '//server/share', 'url/', 'url//resources',
      '..\\outside', 'url\\..\\outside', '\\url',
      'C:\\outside', 'C:/outside', 'C:outside', 'url:stream',
      'url\0outside'
    ];
    const request = { gql: sinon.stub(), buffer: sinon.stub() };
    for (const name of unsafeNames) {
      assert.throws(
        () => new WPTUpdater(name, cli, request, '.', 'testcommit'),
        /Invalid WPT path/,
        JSON.stringify(name)
      );
    }
    assert.strictEqual(request.gql.callCount, 0);
    assert.strictEqual(request.buffer.callCount, 0);
  });

  it('rejects fixture paths outside a strict subdirectory', () => {
    const updater = new WPTUpdater('url', cli, request, '.');
    for (const name of ['../wpt-sibling', '', '.', '..', 'url/..']) {
      assert.throws(() => updater.fixtures(name), /Invalid WPT fixture path/);
    }
    assert.strictEqual(updater.fixtures(), nodePath.join('test', 'fixtures', 'wpt'));
    assert.strictEqual(
      updater.fixtures('url', 'resources', 'test.js'),
      nodePath.join('test', 'fixtures', 'wpt', 'url', 'resources', 'test.js')
    );
  });

  it('updates a nested suite without removing sibling fixtures', async() => {
    const tempDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ncu-wpt-'));
    try {
      const fixtures = nodePath.join(tempDir, 'test', 'fixtures', 'wpt');
      const suite = nodePath.join(fixtures, 'html', 'dom');
      fs.mkdirSync(suite, { recursive: true });
      const stalePath = nodePath.join(suite, 'stale.js');
      const siblingPath = nodePath.join(fixtures, 'html', 'sibling.js');
      const outsidePath = nodePath.join(fixtures, '..', 'outside.txt');
      fs.writeFileSync(stalePath, 'stale');
      fs.writeFileSync(siblingPath, 'sibling');
      fs.writeFileSync(outsidePath, 'outside');

      const request = {
        gql: sinon.stub().resolves({
          repository: {
            object: { entries: [{ name: 'test.js', type: 'blob' }] }
          }
        }),
        buffer: sinon.stub().resolves(Buffer.from('downloaded'))
      };
      const updater = new WPTUpdater('html/dom', new TestCLI(), request, tempDir, 'testcommit');
      await updater.update();
      await updater.updateLicense();

      assert.strictEqual(fs.existsSync(stalePath), false);
      assert.strictEqual(fs.readFileSync(nodePath.join(suite, 'test.js'), 'utf8'), 'downloaded');
      assert.strictEqual(fs.readFileSync(siblingPath, 'utf8'), 'sibling');
      assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), 'outside');
      const licensePath = nodePath.join(fixtures, 'LICENSE.md');
      const versionsPath = nodePath.join(fixtures, 'versions.json');
      assert.strictEqual(fs.readFileSync(licensePath, 'utf8'), 'downloaded');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(versionsPath, 'utf8')), {
        'html/dom': { commit: 'testcommit', path: 'html/dom' }
      });
      assert.deepStrictEqual(request.gql.firstCall.args, ['TreeEntries', {
        owner: 'web-platform-tests',
        repo: 'wpt',
        expression: 'testcommit:html/dom'
      }]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('exits with meaningful error when WPT name not found', async() => {
    wptUpdater = new WPTUpdater(path, cli, request, nodedir);
    let thrown;
    try {
      await wptUpdater.update();
    } catch (e) {
      thrown = e;
    }

    assert(thrown instanceof Error);
    assert(thrown.message, `Cannot find commit for "${path}"`);
    cli.assertCalledWith(
      {

        stopSpinner: [[
          `Cannot find commit for "${path}". Please check the path name.`,
          'failed'
        ]]
      }, { ignore: ['startSpinner', 'separator', 'log', 'updateSpinner'] });
  });

  it('updates versions.json without rewriting README.md', async() => {
    cli.clearCalls();
    const tempDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ncu-wpt-'));
    try {
      const fixtures = nodePath.join(tempDir, 'test', 'fixtures', 'wpt');
      fs.mkdirSync(fixtures, { recursive: true });

      const versionsPath = nodePath.join(fixtures, 'versions.json');
      const readmePath = nodePath.join(fixtures, 'README.md');
      const readme = 'stable README\n';
      fs.writeFileSync(readmePath, readme);
      fs.writeFileSync(versionsPath, JSON.stringify({
        url: {
          commit: 'e4a4672e9e607fc2b28e7173b83ce4e38ef53071',
          path: 'url'
        }
      }, null, 2) + '\n');

      wptUpdater = new WPTUpdater('url', cli, request, tempDir);
      await wptUpdater.updateVersions({
        url: {
          commit: 'd4598eba0959249d8715818a402b432c513f9492',
          path: 'url'
        }
      });

      assert.strictEqual(fs.readFileSync(readmePath, 'utf8'), readme);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(versionsPath, 'utf8')), {
        url: {
          commit: 'd4598eba0959249d8715818a402b432c513f9492',
          path: 'url'
        }
      });
      cli.assertCalledWith({
        startSpinner: [['Updating versions.json ...']],
        stopSpinner: [[`Updated ${versionsPath}`]]
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
