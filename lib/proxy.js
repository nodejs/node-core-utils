import { globalAgent } from 'node:https';
import { spawnSync } from 'child_process';

import ProxyAgent from 'proxy-agent';

import { getMergedConfig } from './config.js';

export default function proxy() {
  let proxyUrl = getMergedConfig().proxy;
  if (proxyUrl == null || proxyUrl === '') {
    proxyUrl = spawnSync(
      'git',
      ['config', '--get', '--path', 'https.proxy']
    ).stdout.toString();
  }
  if (proxyUrl == null || proxyUrl === '') {
    return globalAgent;
  } else {
    return new ProxyAgent(proxyUrl);
  }
}
