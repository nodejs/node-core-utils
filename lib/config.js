'use strict';

const path = require('path');
const os = require('os');
const { readJson, writeJson } = require('./file');
const getNcurcPath = require('./ncurc_path');

exports.getMergedConfig = function(dir, home) {
  const globalConfig = exports.getConfig(true, home);
  const localConfig = exports.getConfig(false, dir);
  return Object.assign(globalConfig, localConfig);
};

exports.getConfig = function(isGlobal, dir) {
  const configPath = exports.getConfigPath(isGlobal, dir);
  return readJson(configPath);
};

exports.getConfigPath = function(isGlobal, dir) {
  if (!isGlobal) {
    const ncuDir = exports.getNcuDir(dir);
    const configPath = path.join(ncuDir, 'config');
    return configPath;
  }

  return getNcurcPath();
};

exports.writeConfig = function(isGlobal, obj, dir) {
  writeJson(exports.getConfigPath(isGlobal, dir), obj);
};

exports.updateConfig = function(isGlobal, obj, dir) {
  const config = exports.getConfig(isGlobal, dir);
  const configPath = exports.getConfigPath(isGlobal, dir);
  writeJson(configPath, Object.assign(config, obj));
};

exports.getHomeDir = function(home) {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }
  return home || os.homedir();
};

exports.getNcuDir = function(dir) {
  return path.join(dir || process.cwd(), '.ncu');
};
