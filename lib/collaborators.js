'use strict';

const rp = require('request-promise-native');

async function getCollaborators(owner, repo) {
  // This is more or less taken from
  // https://github.com/rvagg/iojs-tools/blob/master/pr-metadata/pr-metadata.js
  const RE = /\* \[(.+?)\]\(.+?\) -\s\*\*(.+?)\*\* &lt;(.+?)&gt;/mg;
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;

  const response = await rp({
    url: url
  });

  const members = new Map();
  let m;

  while (m = RE.exec(response)) { // eslint-disable-line no-cond-assign
    members.set(m[1].toLowerCase(), {
      login: m[1],
      name: m[2],
      email: m[3]
    });
  }

  if (!members.size) {
    throw new Error('Could not find any collaborators');
  }

  return members;
}

module.exports = {
  getCollaborators
};
