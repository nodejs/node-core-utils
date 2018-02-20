'use strict';

const assert = require('assert');
const sinon = require('sinon');

const TestCLI = require('../fixtures/test_cli');
const TeamInfo = require('../../lib/team_info');
const { readJSON, readFile, path: getPath } = require('../fixtures');

const collabList =
`- [@Bar](https://github.com/Bar) - Bar Bar
- [@foo](https://github.com/foo) - Mr. foo
- [@quo](https://github.com/quo) - Ms. Quo`;

describe('TeamInfo', function() {
  let request;
  let cli;

  before(() => {
    cli = new TestCLI();
    request = {
      gql: sinon.stub()
    };

    const collab = readJSON('team_collab.json');
    const bots = readJSON('team_bots.json');
    request.gql.withArgs(
      'Team',
      { org: 'nodejs', team: 'automation-collaborators' },
      [ 'organization', 'team', 'members' ]
    ).returns(Promise.resolve(collab.organization.team.members.nodes));
    request.gql.withArgs(
      'Team',
      { org: 'nodejs', team: 'bots' },
      [ 'organization', 'team', 'members' ]
    ).returns(Promise.resolve(bots.organization.team.members.nodes));
    request.gql.returns(new Error('unknown query'));
  });

  after(() => {
    cli.clearCalls();
  });

  it('getMembersContact', async() => {
    const data = new TeamInfo(
      cli, request, 'nodejs', 'automation-collaborators');
    const contact = await data.getMemberContacts();
    assert.strictEqual(contact, collabList);
  });

  it('syncFile() with empty file', async() => {
    const expected = readFile('ncu_team_sync_expected.md');
    await TeamInfo.syncFile(cli, request,
      getPath('ncu_team_sync_in.md'),
      getPath('ncu_team_sync_out.md'));
    const actual = readFile('ncu_team_sync_out.md');
    assert.strictEqual(expected, actual);
  });

  it('syncFile() with old file', async() => {
    const expected = readFile('ncu_team_sync_expected.md');
    await TeamInfo.syncFile(cli, request,
      getPath('ncu_team_sync_out.md'));
    const actual = readFile('ncu_team_sync_out.md');
    assert.strictEqual(expected, actual);
  });

  it('syncFile() with a file without special blocks', async() => {
    const expected = readFile('README', 'README.md');
    let thrown = null;
    try {
      await TeamInfo.syncFile(cli, request, getPath('README', 'README.md'));
    } catch (err) {
      thrown = err;
    }

    assert(thrown instanceof Error);
    assert(thrown.message, 'Could not find blocks matching ' +
      '<!-- ncu-team-sync.team($org/$team)>');
    const actual = readFile('README', 'README.md');
    assert.strictEqual(expected, actual);
  });
});
