'use strict';

const {
  getCollaborators, Collaborator
} = require('../../lib/collaborators');
const assert = require('assert');

describe('collaborators intergration', function() {
  it('getCollaborators', async function() {
    this.timeout(10000);
    const collaborators = await getCollaborators('nodejs', 'node');
    assert(collaborators instanceof Map);
    // first of the list
    assert(collaborators.get('addaleax') instanceof Collaborator);
    // last of the list
    assert(collaborators.get('yosuke-furukawa') instanceof Collaborator);
  });
});
