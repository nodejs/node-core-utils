import path from 'node:path';
import os from 'node:os';

import { readJson, writeJson } from './file.js';

export const GLOBAL_CONFIG = Symbol('globalConfig');
export const PROJECT_CONFIG = Symbol('projectConfig');
export const LOCAL_CONFIG = Symbol('localConfig');

export function getNcurcPath() {
  if (process.env.XDG_CONFIG_HOME !== 'undefined' &&
      process.env.XDG_CONFIG_HOME !== undefined) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ncurc');
  } else {
    return path.join(os.homedir(), '.ncurc');
  }
}

export function getMergedConfig(dir, home) {
  const globalConfig = getConfig(GLOBAL_CONFIG, home);
  const projectConfig = getConfig(PROJECT_CONFIG, dir);
  const localConfig = getConfig(LOCAL_CONFIG, dir);
  return Object.assign(globalConfig, projectConfig, localConfig);
};

export function getConfig(configType, dir) {
  const configPath = getConfigPath(configType, dir);
  try {
    return readJson(configPath);
  } catch (cause) {
    throw new Error('Unable to parse config file ' + configPath, { cause });
  }
};

export function getConfigPath(configType, dir) {
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
};

export function writeConfig(configType, obj, dir) {
  writeJson(getConfigPath(configType, dir), obj);
};

export function updateConfig(configType, obj, dir) {
  const config = getConfig(configType, dir);
  const configPath = getConfigPath(configType, dir);
  writeJson(configPath, Object.assign(config, obj));
};

export function getHomeDir(home) {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }
  return home || os.homedir();
};

export function getNcuDir(dir) {
  return path.join(dir || process.cwd(), '.ncu');
};
