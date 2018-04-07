'use strict';

const path = require('path');
const fs = require('fs');
const { getMergedConfig, getNcuDir } = require('./config');
const rimraf = require('rimraf');
const { readJson, writeJson, readFile, writeFile } = require('./file');
const APPLYING = 'applying';
const STARTED = 'started';
const AMENDING = 'AMENDING';

class Session {
  constructor(dir, prid, config) {
    this.dir = dir;
    this.prid = prid;
    this.config = config || getMergedConfig(this.dir);
  }

  get session() {
    return readJson(this.sessionPath);
  }

  get gitDir() {
    return path.join(this.dir, '.git');
  }

  get ncuDir() {
    return getNcuDir(this.dir);
  }

  get argv() {
    return {
      owner: this.owner,
      repo: this.repo,
      upstream: this.upstream,
      branch: this.branch,
      readme: this.readme,
      prid: this.prid
    };
  }

  get sessionPath() {
    return path.join(this.ncuDir, 'land');
  }

  get owner() {
    return this.config.owner || 'nodejs';
  }

  get repo() {
    return this.config.repo || 'node';
  }

  get upstream() {
    return this.config.upstream;
  }

  get branch() {
    return this.config.branch;
  }

  get readme() {
    return this.config.readme;
  }

  get pullName() {
    return `${this.owner}/${this.repo}/pulls/${this.prid}`;
  }

  get pullDir() {
    return path.join(this.ncuDir, `${this.prid}`);
  }

  startLanding() {
    writeJson(this.sessionPath, {
      state: STARTED,
      prid: this.prid,
      config: this.config
    });
  }

  startApplying() {
    this.updateSession({
      state: APPLYING
    });
  }

  startAmending() {
    this.updateSession({
      state: AMENDING
    });
  }

  cleanFiles() {
    var sess;
    try {
      sess = this.session;
    } catch (err) {
      return rimraf.sync(this.sessionPath);
    }

    if (sess.prid && sess.prid === this.prid) {
      rimraf.sync(this.pullDir);
    }
    rimraf.sync(this.sessionPath);
  }

  get statusPath() {
    return path.join(this.pullDir, 'status');
  }

  get status() {
    return readJson(this.statusPath);
  }

  get metadataPath() {
    return path.join(this.pullDir, 'metadata');
  }

  get metadata() {
    return readFile(this.metadataPath);
  }

  get patchPath() {
    return path.join(this.pullDir, 'patch');
  }

  get patch() {
    return readFile(this.patchPath);
  }

  getMessagePath(rev) {
    return path.join(this.pullDir, `${rev.slice(0, 7)}-message`);
  }

  updateSession(update) {
    const old = this.session;
    writeJson(this.sessionPath, Object.assign(old, update));
  }

  saveStatus(status) {
    writeJson(this.statusPath, status);
  }

  saveMetadata(status) {
    writeFile(this.metadataPath, status.metadata);
  }

  savePatch(patch) {
    writeFile(this.patchPath, patch);
  }

  saveMessage(rev, message) {
    const file = this.getMessagePath(rev);
    writeFile(file, message);
    return file;
  }

  hasStarted() {
    return !!this.session.prid && this.session.prid === this.prid;
  }

  readyToApply() {
    return this.session.state === APPLYING;
  }

  readyToAmend() {
    return this.session.state === AMENDING;
  }

  readyToFinal() {
    if (this.amInProgress()) {
      return false;  // git am/rebase in progress
    }
    return this.session.state === AMENDING;
  }

  // Refs: https://github.com/git/git/blob/99de064/git-rebase.sh#L208-L228
  amInProgress() {
    const amPath = path.join(this.gitDir, 'rebase-apply', 'applying');
    return fs.existsSync(amPath);
  }

  rebaseInProgress() {
    if (this.amInProgress()) {
      return false;
    }

    const normalRebasePath = path.join(this.gitDir, 'rebase-apply');
    const mergeRebasePath = path.join(this.gitDir, 'rebase-merge');
    return fs.existsSync(normalRebasePath) || fs.existsSync(mergeRebasePath);
  }

  restore() {
    const sess = this.session;
    if (sess.prid) {
      this.prid = sess.prid;
      this.config = sess.config;
    }
    return this;
  }
}

module.exports = Session;
