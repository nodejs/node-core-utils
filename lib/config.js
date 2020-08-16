'use strict';

const path = require('path');
const os = require('os');
const { readJson, writeJson } = require('./file');

const GLOBAL_CONFIG = Symbol('globalConfig');
const PROJECT_CONFIG = Symbol('projectConfig');
const LOCAL_CONFIG = Symbol('localConfig');

function getNcurcPath() {
  let configHome = os.homedir();
  if (process.platform === 'linux') {
    configHome = process.env.XDG_CONFIG_HOME || `${os.homedir()}/.config`;
  }
  return path.join(configHome, '.ncurc');
}

function getMergedConfig(dir, home) {
  const globalConfig = getConfig(GLOBAL_CONFIG, home);
  const projectConfig = getConfig(PROJECT_CONFIG, dir);
  const localConfig = getConfig(LOCAL_CONFIG, dir);
  return Object.assign(globalConfig, projectConfig, localConfig);
}

function getConfig(configType, dir) {
  const configPath = getConfigPath(configType, dir);
  return readJson(configPath);
}

function getConfigPath(configType, dir) {
  switch (configType) {
    case GLOBAL_CONFIG:
      return getNcurcPath();
    case PROJECT_CONFIG: {
      const projectRcPath = path.join(dir || process.cwd(), '.ncurc');
      return projectRcPath;
    }
    case LOCAL_CONFIG: {
      const ncuDir = getNcuDir(dir);
      const configPath = path.join(ncuDir, 'config');
      return configPath;
    }
    default:
      throw Error('Invalid configType');
  }
}

function writeConfig(configType, obj, dir) {
  writeJson(getConfigPath(configType, dir), obj);
}

function updateConfig(configType, obj, dir) {
  const config = getConfig(configType, dir);
  const configPath = getConfigPath(configType, dir);
  writeJson(configPath, Object.assign(config, obj));
}

function getHomeDir(home) {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }
  return home || os.homedir();
}

function getNcuDir(dir) {
  return path.join(dir || process.cwd(), '.ncu');
}

module.exports = {
  GLOBAL_CONFIG,
  PROJECT_CONFIG,
  LOCAL_CONFIG,
  getConfig,
  getConfigPath,
  getHomeDir,
  getNcuDir,
  getNcurcPath,
  getMergedConfig,
  updateConfig,
  writeConfig
};
