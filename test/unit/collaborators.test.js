'use strict';

const {
  getCollaborators
} = require('../../lib/collaborators');
const { readme, collaborators } = require('../fixtures/data');
const TestLogger = require('../fixtures/test_logger');
const logger = new TestLogger();
const assert = require('assert');

describe('collaborators', function() {
  it('getCollaborators', async function() {
    const parsed = await getCollaborators(readme, logger, 'nodejs', 'node');
    assert.deepStrictEqual(parsed, collaborators);
  });
});
