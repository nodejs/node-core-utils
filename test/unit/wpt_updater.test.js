import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
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

  it('exits with meaningful error when WPT name not found', async() => {
    path = UNKNOWN_PATH;
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
});
