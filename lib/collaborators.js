'use strict';

const fs = require('fs');

const TSC_TITLE = '### TSC (Technical Steering Committee)';
const TSCE_TITLE = '### TSC Emeriti';
const CL_TITLE = '### Collaborators';
const CLE_TITLE = '### Collaborator Emeriti';
const CONTACT_RE = /\* +\[(.+?)\]\(.+?\) +-\s\*\*(.+?)\*\* +&lt;(.+?)&gt;/mg;

const TSC = 'TSC';
const COLLABORATOR = 'COLLABORATOR';

class Collaborator {
  constructor(login, name, email, type) {
    this.login = login;  // This is not lowercased
    this.name = name;
    this.email = email;
    this.type = type;
  }

  isActor(actor) {
    if (!actor || !actor.login) {  // ghost
      return false;
    }
    return actor.login.toLowerCase() === this.login.toLowerCase();
  }

  isTSC() {
    return this.type === TSC;
  }

  getName() {
    return `${this.name} (@${this.login})`;
  }

  getContact() {
    return `${this.name} <${this.email}>`;
  }
}

Collaborator.TYPES = {
  TSC, COLLABORATOR
};

async function getCollaborators(cli, request, argv) {
  const { readme, owner, repo } = argv;
  let readmeText;
  if (readme) {
    cli.updateSpinner(`Reading collaborator contacts from ${readme}`);
    readmeText = fs.readFileSync(readme, 'utf8');
  } else {
    cli.updateSpinner(
      `Getting collaborator contacts from README of ${owner}/${repo}`);
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;
    readmeText = await request.text(url);
  }

  let collaborators;
  try {
    collaborators = parseCollaborators(readmeText, cli);
  } catch (err) {
    const readmePath = readme || `${owner}/${repo}/README.md`;
    cli.stopSpinner(`Failed to get collaborator info from ${readmePath}`,
      cli.SPINNER_STATUS.FAILED);
    throw err;
  }
  return collaborators;
}

function parseCollaborators(readme, cli) {
  // This is more or less taken from
  // https://github.com/rvagg/iojs-tools/blob/master/pr-metadata/pr-metadata.js
  const collaborators = new Map();
  let m;

  const tscIndex = readme.indexOf(TSC_TITLE);
  const tsceIndex = readme.indexOf(TSCE_TITLE);
  const clIndex = readme.indexOf(CL_TITLE);
  const cleIndex = readme.indexOf(CLE_TITLE);

  if (tscIndex === -1) {
    throw new Error(`Couldn't find ${TSC_TITLE} in the README`);
  }
  if (tsceIndex === -1) {
    throw new Error(`Couldn't find ${TSCE_TITLE} in the README`);
  }
  if (clIndex === -1) {
    throw new Error(`Couldn't find ${CL_TITLE} in the README`);
  }
  if (cleIndex === -1) {
    throw new Error(`Couldn't find ${CLE_TITLE} in the README`);
  }

  if (!(tscIndex < tsceIndex &&
        tsceIndex < clIndex &&
        clIndex < cleIndex)) {
    cli.warn('Contacts in the README is out of order, ' +
             'analysis could go wrong.', { newline: true });
  }

  // We also assume that TSC & TSC Emeriti are also listed as collaborators
  CONTACT_RE.lastIndex = tscIndex;
  // eslint-disable-next-line no-cond-assign
  while ((m = CONTACT_RE.exec(readme)) && CONTACT_RE.lastIndex < tsceIndex) {
    const login = m[1].toLowerCase();
    const user = new Collaborator(m[1], m[2], m[3], TSC);
    collaborators.set(login, user);
  }

  CONTACT_RE.lastIndex = clIndex;
  // eslint-disable-next-line no-cond-assign
  while ((m = CONTACT_RE.exec(readme)) &&
    CONTACT_RE.lastIndex < cleIndex) {
    const login = m[1].toLowerCase();
    if (!collaborators.get(login)) {
      const user = new Collaborator(m[1], m[2], m[3], COLLABORATOR);
      collaborators.set(login, user);
    }
  }

  if (!collaborators.size) {
    throw new Error('Could not find any collaborators');
  }

  return collaborators;
}

/**
 * @param {Map<string, Collaborator>} collaborators
 * @param {{login?: string}} user
 */
function isCollaborator(collaborators, user) {
  return (user && user.login &&  // could be a ghost
    collaborators.get(user.login.toLowerCase()));
}

module.exports = {
  getCollaborators,
  Collaborator,
  isCollaborator
};
