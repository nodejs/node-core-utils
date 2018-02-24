const path = require('path');
const os = require('os');
const cloneDeep = require('lodash.clonedeep');

const fileContent = JSON.stringify(require('./fs_config_file'));
const localConfigContent = JSON.stringify(require('./fs_local_config_file'));

class MockFs {
  constructor() {
    // Initial File System
    this.initialFilesState = {
      [path.join('files', 'file.json')]: fileContent,
      [path.join(os.homedir(), '.ncurc')]: fileContent,
      [path.join(process.cwd(), '.ncu', 'config')]: localConfigContent
    };
    this.files = cloneDeep(this.initialFilesState);

    // Methods bindings`
    this.restoreFs = this.restoreFs.bind(this);
    this.existsSync = this.existsSync.bind(this);
    this.readFileSync = this.readFileSync.bind(this);
    this.writeFileSync = this.writeFileSync.bind(this);
    this.sync = this.sync.bind(this);
  }

  restoreFs() {
    this.files = cloneDeep(this.initialFilesState);
  }

  existsSync(pathToFile) {
    return !!this.files[pathToFile] ||
      !!this.files[path.parse(pathToFile).dir];
  }

  readFileSync(pathToFile) {
    if (this.files[pathToFile]) {
      return this.files[pathToFile];
    }

    return new Error('File not found.');
  }

  writeFileSync(pathToFile, content) {
    // Dont't stringify the content becasuse file.writeJson does it
    this.files[pathToFile] = content;
  }

  // mkdirp.sync method
  sync(pathToFile) {
    this.files[pathToFile] = { };
  }
};

module.exports = MockFs;
