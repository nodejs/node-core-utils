'use strict';

const assert = require('assert');

const {
  isCollaborator,
  getCollaborators
} = require('../../lib/collaborators');
const {
  readme,
  readmeNoTsc,
  readmeNoTscE,
  readmeNoCollaborators,
  readmeNoCollaboratorE,
  readmeUnordered,
  collaborators
} = require('../fixtures/data');
const TestLogger = require('../fixtures/test_logger');
const assertThrowsAsync = require('../fixtures/assert_throws_async');

describe('collaborators', function() {
  const collaborator = collaborators.get('bar');
  let logger = null;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('Collaborator', () => {
    describe('isActor', () => {
      it('should return false if actor is a ghost', () => {
        assert.strictEqual(collaborator.isActor(null), false);
      });

      it('should return false if the actor has no login', () => {
        const collaboratorNoLogin = {
          name: 'Bar User',
          email: 'bar@example.com',
          type: 'TSC'
        };
        assert.strictEqual(collaborator.isActor(collaboratorNoLogin), false);
      });

      it(
        'should return true if the the collaborator and actor login are equal',
        () => {
          assert.strictEqual(collaborator.isActor(collaborator), true);
        });
    });

    describe('isTSC', () => {
      it('should return true if collaborator type is TSC', () => {
        // Collaborator 'bar' is TSC
        assert.strictEqual(collaborator.isTSC(), true);
      });

      it('should return false if the collaborator type is not TSC', () => {
        // Collaborator 'foo' is not TSC
        const collaboratorNoTSC = collaborators.get('foo');
        assert.strictEqual(collaboratorNoTSC.isTSC(), false);
      });
    });

    describe('getName', () => {
      it('should return the name and login', () => {
        collaborators.forEach(collaborator => {
          assert.strictEqual(
            collaborator.getName(),
            `${collaborator.name}(${collaborator.login})`);
        });
      });
    });

    describe('getContact', () => {
      it('should return the name and the email', () => {
        collaborators.forEach(collaborator => {
          assert.strictEqual(
            collaborator.getContact(),
            `${collaborator.name} <${collaborator.email}>`);
        });
      });
    });
  });

  describe('getCollaborators', () => {
    it('should return all collaborators', async function() {
      const parsed = await getCollaborators(readme, logger, 'nodejs', 'node');
      assert.deepStrictEqual(parsed, collaborators);
    });

    it(
      'should throw error if there is no TSC section in the README',
      async() => {
        await assertThrowsAsync(
          async() => getCollaborators(readmeNoTsc, logger, 'nodejs', 'node'),
          Error);
      });

    it(
      'should throw error if there is no TSC Emeriti section in the README',
      async() => {
        await assertThrowsAsync(
          async() => getCollaborators(readmeNoTscE, logger, 'nodejs', 'node'),
          /Error: Couldn't find ### TSC Emeriti in the README/);
      });

    it('should throw error if there is no Collaborators section in the README',
      async() => {
        await assertThrowsAsync(
          async() => getCollaborators(
            readmeNoCollaborators, logger, 'nodejs', 'node'),
          /Error: Couldn't find ### Collaborators in the README/);
      });

    it(
      'should throw error if there is no Collaborator' +
      'Emeriti section in the README',
      async() => {
        await assertThrowsAsync(
          async() => getCollaborators(
            readmeNoCollaboratorE, logger, 'nodejs', 'node'),
          /Error: Couldn't find ### Collaborator Emeriti in the README/);
      });

    it(
      'should WARN if the TSC and Collaborators' +
      'section are not ordered in the README',
      async() => {
        await assertThrowsAsync(
          async() => getCollaborators(
            readmeUnordered, logger, 'nodejs', 'node'),
          /Error/);
        assert.strictEqual(logger.logs.warn[0][0],
          'Order of different types of contacts needs update. ' +
          'Analysis could get wrong.');
      });

    it('should throw error if there are no collaborators', async() => {
      await assertThrowsAsync(
        async() => getCollaborators(readmeUnordered, logger, 'nodejs', 'node'),
        /Error: Could not find any collaborators/);
    });
  });

  describe('isCollaborator', () => {
    it('should return null if the user is a ghost', () => {
      assert.strictEqual(
        isCollaborator(collaborators, null), null);
    });

    it(
      'should return undefined if the user is valid ' +
      'but is not a collaborator', () => {
        assert.strictEqual(
          isCollaborator(
            collaborators,
            { name: 'User', login: 'user', email: 'user@example.com' }),
          undefined);
      });

    it(
      'should return the collaborator info if' +
      ' the user is in the collaborators list',
      () => {
        assert.strictEqual(
          isCollaborator(collaborators, collaborator), collaborator);
      });
  });
});
