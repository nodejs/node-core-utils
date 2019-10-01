'use strict';

const path = require('path');
const os = require('os');
const { readJson, writeJson } = require('./file');

const GLOBAL_CONFIG = Symbol('globalConfig');
const PROJECT_CONFIG = Symbol('projectConfig');
const LOCAL_CONFIG = Symbol('localConfig');

exports.GLOBAL_CONFIG = GLOBAL_CONFIG;
exports.PROJECT_CONFIG = PROJECT_CONFIG;
exports.LOCAL_CONFIG = LOCAL_CONFIG;

function getNcurcPath() {
  if (process.env.XDG_CONFIG_HOME !== 'undefined' &&
      process.env.XDG_CONFIG_HOME !== undefined) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ncurc');
  } else {
    return path.join(os.homedir(), '.ncurc');
  }
}
exports.getNcurcPath = getNcurcPath;

exports.getMergedConfig = function(dir, home) {
  const globalConfig = exports.getConfig(GLOBAL_CONFIG, home);
  const projectConfig = exports.getConfig(PROJECT_CONFIG, dir);
  const localConfig = exports.getConfig(LOCAL_CONFIG, dir);
  return Object.assign(globalConfig, projectConfig, localConfig);
};

exports.getConfig = function(configType, dir) {
  const configPath = exports.getConfigPath(configType, dir);
  return readJson(configPath);
};

exports.getConfigPath = function(configType, dir) {
  switch (configType) {
    case GLOBAL_CONFIG:
      return getNcurcPath();
    case PROJECT_CONFIG:
      const projectRcPath = path.join(dir || process.cwd(), '.ncurc');
      return projectRcPath;
    case LOCAL_CONFIG:
      const ncuDir = exports.getNcuDir(dir);
      const configPath = path.join(ncuDir, 'config');
      return configPath;
    default:
      throw Error('Invalid configType');
  }
};

exports.writeConfig = function(configType, obj, dir) {
  writeJson(exports.getConfigPath(configType, dir), obj);
};

exports.updateConfig = function(configType, obj, dir) {
  const config = exports.getConfig(configType, dir);
  const configPath = exports.getConfigPath(configType, dir);
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
