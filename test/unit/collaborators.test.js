'use strict';

const {
  getCollaborators, Collaborator
} = require('../../lib/collaborators');
const { readFile } = require('../fixtures');
const TestLogger = require('../fixtures/test_logger');
const logger = new TestLogger();
const assert = require('assert');
const readme = readFile('README.md');

describe('collaborators', function() {
  // TODO: make a fake README.md, or generate one with existing collaborators
  // Test type=TSC and stuff
  it('getCollaborators', async function() {
    const collaborators = await getCollaborators(readme, logger, 'nodejs', 'node');
    assert(collaborators instanceof Map);
    // first of the list
    assert(collaborators.get('addaleax') instanceof Collaborator);
    // last of the list
    assert(collaborators.get('yosuke-furukawa') instanceof Collaborator);
    assert.deepStrictEqual(logger.logs, {
      info: [], error: [], warn: [], trace: []
    });
  });
});
