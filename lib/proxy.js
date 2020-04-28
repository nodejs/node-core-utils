const ProxyAgent = require('proxy-agent');
const { globalAgent } = require('https');
const { spawnSync } = require('child_process');
const { getMergedConfig } = require('./config');

function proxy() {
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

module.exports = proxy;
