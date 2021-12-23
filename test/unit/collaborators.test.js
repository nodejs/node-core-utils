import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

import {
  isCollaborator,
  getCollaborators
} from '../../lib/collaborators.js';

import {
  readme,
  readmeAlternative,
  readmeNoTsc,
  readmeNoTscE,
  readmeNoCollaborators,
  readmeNoCollaboratorE,
  readmeUnordered,
  collaborators,
  collaboratorsAlternative
} from '../fixtures/data.js';
import TestCLI from '../fixtures/test_cli.js';
import assertThrowsAsync from '../fixtures/assert_throws_async.js';

describe('collaborators', function() {
  const collaborator = collaborators.get('bar');

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
        'should return true if the collaborator and actor login are equal',
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
            `${collaborator.name} (@${collaborator.login})`);
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
    let cli = null;

    beforeEach(() => {
      cli = new TestCLI();
    });

    function mockRequest(content, argv) {
      const { owner, repo } = argv;
      const expectedUrl =
        `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`;
      return {
        async text(url) {
          assert.strictEqual(url, expectedUrl);
          return content;
        }
      };
    }

    it('should use specified readme', async function() {
      const readmePath =
        fileURLToPath(new URL('../fixtures/README/README.md', import.meta.url));
      const argv = { owner: 'nodejs', repo: 'node', readme: readmePath };
      const request = { async text() { assert.fail('should not call'); } };
      const parsed = await getCollaborators(cli, request, argv);
      assert.deepStrictEqual(parsed, collaborators);
    });

    it('should return all collaborators', async function() {
      const argv = { owner: 'nodejs', repo: 'node' };
      const request = mockRequest(readme, argv);
      const parsed = await getCollaborators(cli, request, argv);
      assert.deepStrictEqual(parsed, collaborators);
    });

    it('should parse names with parentheses',
      async() => {
        const argv = { owner: 'nodejs', repo: 'node' };
        const request = mockRequest(readmeAlternative, argv);
        const parsed = await getCollaborators(cli, request, argv);
        assert.deepStrictEqual(parsed, collaboratorsAlternative);
      });

    it('should throw error if there is no TSC section in the README',
      async() => {
        const argv = { owner: 'nodejs', repo: 'node' };
        const request = mockRequest(readmeNoTsc, argv);
        await assertThrowsAsync(
          async() => getCollaborators(cli, request, argv),
          Error);
      });

    it(
      'should throw error if there is no TSC Emeriti section in the README',
      async() => {
        const argv = { owner: 'nodejs', repo: 'node' };
        const request = mockRequest(readmeNoTscE, argv);
        await assertThrowsAsync(
          async() => getCollaborators(cli, request, argv),
          /Error: Couldn't find ### TSC Emeriti in the README/);
      });

    it('should throw error if there is no Collaborators section in the README',
      async() => {
        const argv = { owner: 'nodejs', repo: 'node' };
        const request = mockRequest(readmeNoCollaborators, argv);
        await assertThrowsAsync(
          async() => getCollaborators(cli, request, argv),
          /Error: Couldn't find ### Collaborators in the README/);
      });

    it(
      'should throw error if there is no Collaborator' +
      'Emeriti section in the README',
      async() => {
        const argv = { owner: 'nodejs', repo: 'node' };
        const request = mockRequest(readmeNoCollaboratorE, argv);
        await assertThrowsAsync(
          async() => getCollaborators(cli, request, argv),
          /Error: Couldn't find ### Collaborator Emeriti in the README/);
      });

    it(
      'should WARN if the TSC and Collaborators' +
      'section are not ordered in the README',
      async() => {
        const argv = { owner: 'nodejs', repo: 'node' };
        const request = mockRequest(readmeUnordered, argv);
        await assertThrowsAsync(
          async() => getCollaborators(cli, request, argv),
          /Error/);
        cli.assertCalledWith({
          warn: [[
            'Contacts in the README is out of order, analysis could go wrong.',
            { newline: true }
          ]]
        }, { ignore: ['updateSpinner', 'stopSpinner'] });
      });

    it('should throw error if there are no collaborators', async() => {
      const argv = { owner: 'nodejs', repo: 'node' };
      const request = mockRequest(readmeUnordered, argv);
      await assertThrowsAsync(
        async() => getCollaborators(cli, request, argv),
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
