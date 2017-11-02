'use strict';

const {
  getCollaborators, Collaborator
} = require('../../lib/collaborators');
const TestLogger = require('../fixtures/test_logger');
const logger = new TestLogger();
const assert = require('assert');
const requestPromise = require('request-promise-native');

describe('collaborators intergration', function() {
  it('getCollaborators', async function() {
    this.timeout(10000);
    const collaborators = await getCollaborators(requestPromise, logger, 'nodejs', 'node');
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
