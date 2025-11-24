import path from 'node:path';
import os from 'node:os';

import { readJson, writeJson } from './file.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { forceRunAsync, runSync } from './run.js';

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

let mergedConfig;
export function getMergedConfig(dir, home, additional) {
  if (mergedConfig == null) {
    const globalConfig = getConfig(GLOBAL_CONFIG, home);
    const projectConfig = getConfig(PROJECT_CONFIG, dir);
    const localConfig = getConfig(LOCAL_CONFIG, dir);
    mergedConfig = Object.assign(globalConfig, projectConfig, localConfig, additional);
  }
  return mergedConfig;
};
export function clearCachedConfig() {
  mergedConfig = null;
}

export async function encryptValue(input) {
  console.warn('Spawning gpg to encrypt the config value');
  return forceRunAsync(
    process.env.GPG_BIN || 'gpg',
    ['--default-recipient-self', '--encrypt', '--armor'],
    {
      captureStdout: true,
      ignoreFailure: false,
      input
    }
  );
}

function setOwnProperty(target, key, value) {
  return Object.defineProperty(target, key, {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value
  });
}
function addEncryptedPropertyGetter(target, key, input) {
  if (input?.startsWith?.('-----BEGIN PGP MESSAGE-----\n')) {
    return Object.defineProperty(target, key, {
      __proto__: null,
      configurable: true,
      get() {
        // Using an error object to get a stack trace in debug mode.
        const warn = new Error(
          `The config value for ${key} is encrypted, spawning gpg to decrypt it...`
        );
        console.warn(setOwnProperty(warn, 'name', 'Warning'));
        const value = runSync(process.env.GPG_BIN || 'gpg', ['--decrypt'], { input });
        setOwnProperty(target, key, value);
        return value;
      },
      set(newValue) {
        if (!addEncryptedPropertyGetter(target, key, newValue)) {
          throw new Error(
            'Refusing to override an encrypted value with a non-encrypted one. ' +
            'Please use an encrypted one, or delete the config key first.'
          );
        }
      }
    });
  }
}

export function getConfig(configType, dir, raw = false) {
  const configPath = getConfigPath(configType, dir);
  const encryptedConfigPath = configPath + '.gpg';
  if (existsSync(encryptedConfigPath)) {
    console.warn('Encrypted config detected, spawning gpg to decrypt it...');
    const { status, stdout } =
      spawnSync(process.env.GPG_BIN || 'gpg', ['--decrypt', encryptedConfigPath]);
    if (status === 0) {
      return JSON.parse(stdout.toString('utf-8'));
    }
  }
  try {
    const json = readJson(configPath);
    if (!raw) {
      // Raw config means encrypted values are returned as is.
      // Otherwise we install getters to decrypt them when accessed.
      for (const [key, val] of Object.entries(json)) {
        addEncryptedPropertyGetter(json, key, val);
      }
    }
    return json;
  } catch (cause) {
    throw new Error('Unable to parse config file ' + configPath, { cause });
  }
};

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
};

function writeConfig(configType, obj, dir) {
  const configPath = getConfigPath(configType, dir);
  const encryptedConfigPath = configPath + '.gpg';
  if (existsSync(encryptedConfigPath)) {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ncurc-'));
    const tmpFile = path.join(tmpDir, 'config.json');
    try {
      writeJson(tmpFile, obj);
      const { status } = spawnSync(process.env.GPG_BIN || 'gpg',
        ['--default-recipient-self', '--yes', '--encrypt', '--output', encryptedConfigPath, tmpFile]
      );
      if (status !== 0) {
        throw new Error('Failed to encrypt config file: ' + encryptedConfigPath);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return encryptedConfigPath;
  }
  writeJson(configPath, obj);
  return configPath;
};

export function updateConfig(configType, obj, dir) {
  const config = getConfig(configType, dir, true);
  writeConfig(configType, Object.assign(config, obj), dir);
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
