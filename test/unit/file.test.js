'use strict';

const assert = require('assert');
const path = require('path');
const sinon = require('sinon');
let fs = require('fs');
const mkdirp = require('mkdirp');

const { readFile, writeFile, readJson, writeJson } = require('../../lib/file');

const MockFs = require('../fixtures/fs');
const parsedFileExample = require('../fixtures/fs_config_file');
const stringifiedFileExample = JSON.stringify(parsedFileExample);

const filePath = path.join('files', 'file.json');
const newUsername = 'bar';
const newToken = 'asdfghj';

describe('file', () => {
  let mockFs = null;

  // Original fs and mkdirp methods to be mocked
  let originalExistsSync = fs.existsSync;
  let originalReadFileSyc = fs.readFileSync;
  let originalWriteFileSync = fs.writeFileSync;
  let originalSync = mkdirp.sync;

  before(() => {
    mockFs = new MockFs();
    fs.existsSync = mockFs.existsSync;
    fs.readFileSync = mockFs.readFileSync;
    fs.writeFileSync = mockFs.writeFileSync;
    mkdirp.sync = mockFs.sync;
  });

  after(() => {
    // Restore original methods
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSyc;
    fs.writeFileSync = originalWriteFileSync;
    mkdirp.sync = originalSync;
  });

  afterEach(() => {
    // Restore fs after tests run
    mockFs.restoreFs();
  });

  describe('readFile', () => {
    it('should return file content', () => {
      const fileContent = readFile(filePath);
      assert.strictEqual(fileContent, stringifiedFileExample);
    });

    it('should return empty string if the file does not exist', () => {
      const fileContent = readFile('notfound.json');
      assert.strictEqual(fileContent, '');
    });
  });

  describe('readJson', () => {
    it('should return the parsed JSON file', () => {
      const parsedFile = readJson(filePath);
      assert.strictEqual(parsedFile.username, parsedFileExample.username);
      assert.strictEqual(parsedFile.token, parsedFileExample.token);
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
