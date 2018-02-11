'use strict';

const assert = require('assert');
const path = require('path');
const mockFs = require('mock-fs');
const sinon = require('sinon');

const { readFile, writeFile, readJson, writeJson } = require('../../lib/file');

const username = 'foo';
const token = '123456789';
const fileContent =
  `{
    "username": "${username}",
    "token": "${token}"
  }`;

const mockDirName = 'files';
const mockFileName = 'file.json';
const filePath = path.join(mockDirName, mockFileName);

const newUsername = 'bar';
const newToken = 'asdfghj';

describe('file', () => {
  beforeEach(() => {
    mockFs({
      [mockDirName]: {
        [mockFileName]: fileContent
      }
    });
  });

  afterEach(() => {
    // Restore fs after tests run
    mockFs.restore();
  });

  describe('readFile', () => {
    it('should return file content', () => {
      const fileContent = readFile(filePath);
      assert.strictEqual(fileContent, fileContent);
    });

    it('should return empty string if the file does not exist', () => {
      const fileContent = readFile('notfound.json');
      assert.strictEqual(fileContent, '');
    });
  });

  describe('readJson', () => {
    it('should return the parsed JSON file', () => {
      const parsedFile = readJson(filePath);
      assert.strictEqual(parsedFile.username, username);
      assert.strictEqual(parsedFile.token, token);
    });

    it('should return empty object if the file does not exist', () => {
      const parsedFile = readJson('notfound.json');
      assert.deepEqual(parsedFile, {});
    });
  });

  describe('writeFile', () => {
    const newFileContent =
      `{
        "username": "${newUsername}",
        "token": "${newToken}"
      }`;

    it('should modify the file correctly', () => {
      writeFile(filePath, newFileContent);

      const fileContent = readJson(filePath);
      assert.strictEqual(fileContent.username, newUsername);
      assert.strictEqual(fileContent.token, newToken);
    });

    it('should create the file if it does not exist', () => {
      const configPath = path.join('ncucfg', 'config.json');
      writeFile(configPath, newFileContent);

      const fileContent = readJson(configPath);
      assert.strictEqual(fileContent.username, newUsername);
      assert.strictEqual(fileContent.token, newToken);
    });
  });

  describe('writeJson', () => {
    let writeFileSpy = null;

    before(() => {
      writeFileSpy = sinon.spy(require('../../lib/file'), 'writeFile');
    });

    after(() => {
      writeFileSpy.restore();
    });

    it('it should call writeJson', () => {
      const newContent = {
        username: newUsername,
        token: newToken
      };
      writeJson(filePath, newContent);

      assert.strictEqual(writeFileSpy.called, true);
    });
  });
});
