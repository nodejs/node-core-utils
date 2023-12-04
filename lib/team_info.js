import { readFile, writeFile } from './file.js';
import { ascending, extractReleasersFromReadme, checkReleaserDiscrepancies } from './utils.js';

const TEAM_QUERY = 'Team';

function byLogin(a, b) {
  return ascending(a.login.toLowerCase(), b.login.toLowerCase());
}

function getContact({ login, url, name, email }) {
  if (!name) return `* [@${login}](${url})`;
  return `* [@${login}](${url}) - ${name}`;
}

function key(org, team) {
  return `${org}/${team}`;
}

export default class TeamInfo {
  constructor(cli, request, org, team) {
    this.cli = cli;
    this.request = request;
    this.org = org;
    this.team = team;
    this.members = [];
  }

  async getMembers() {
    const { cli, request, org, team } = this;
    cli.startSpinner(`Getting member information of ${org}/${team}`);
    const members = await request.gql(TEAM_QUERY, { org, team }, [
      'organization', 'team', 'members'
    ]);
    cli.stopSpinner(`Received member information of ${org}/${team}`);
    const sorted = members.sort(byLogin);
    this.members = sorted;
    return sorted;
  }

  async getGpgPublicKey(login) {
    const { request } = this;
    const url = `https://api.github.com/users/${login}/gpg_keys`;
    const result = await request.json(url);
    return result;
  }

  async getMemberContacts() {
    const members = await this.getMembers();
    return members.map(getContact).join('\n');
  }

  async listMembers() {
    const contacts = await this.getMemberContacts();
    this.cli.log(contacts);
  }

  async checkTeamPGPKeys() {
    const { cli } = this;
    cli.startSpinner(`Collecting Members details of ${this.org}/${this.team}`);
    const members = await this.getMembers();
    cli.stopSpinner(`Collecting Members details of ${this.org}/${this.team}`);

    cli.startSpinner(`Collecting PGP keys of ${this.org}/${this.team}`);
    const keys = await Promise.all(members.map(member => this.getGpgPublicKey(member.login)));
    // Add keys to members
    members.forEach((member, index) => {
      member.keys = keys[index];
    });
    cli.stopSpinner(`Collecting PGP keys of ${this.org}/${this.team}`);

    cli.startSpinner('Collecting Release members from Readme.md');
    const readmeTxt = await this.request.text('https://raw.githubusercontent.com/nodejs/node/main/README.md');
    const extractedMembers = extractReleasersFromReadme(readmeTxt);
    cli.stopSpinner('Collecting Release members from Readme.md');

    // Checks per member
    cli.startSpinner('Checking discrepancies between members and readme.md');

    for (const member of members) {
      if (!member.keys || !member.keys.length) {
        console.error(`The releaser ${member.name} (${member.login}) has no keys associated with their account`);
      }
      checkReleaserDiscrepancies(member, extractedMembers);
      // @TODO: Check if the GPG key is available in https://keys.openpgp.org/
    }

    cli.stopSpinner('Checking discrepancies between members and readme.md');
  }
}

TeamInfo.syncFile = async function(cli, request, input, output) {
  output = output || input;
  const content = readFile(input);
  if (content === '') {
    cli.error('input file `' + input + '` is empty or missing');
    process.exit(1);
  }
  const newContent = await TeamInfo.update(cli, request, content);
  writeFile(output, newContent);
  cli.log(`Updated ${output}`);
};

TeamInfo.update = async function(cli, request, content) {
  const RE = new RegExp('<!-- ncu-team-sync\\.team\\((.+)\\/(.+)\\) -->' +
                        '[\\s\\S]+?' +
                        '<!-- ncu-team-sync end -->', 'mg');

  const blocks = new Map();
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = RE.exec(content))) {
    const [, org, team] = m;
    const mapKey = key(org, team);
    if (!blocks.get(mapKey)) {
      const info = new TeamInfo(cli, request, org, team);
      const teamData = await info.getMemberContacts();
      const opening = `<!-- ncu-team-sync.team(${org}/${team}) -->`;
      const ending = '<!-- ncu-team-sync end -->';
      blocks.set(mapKey, `${opening}\n\n${teamData}\n\n${ending}`);
    };
  }

  if (blocks.size === 0) {
    throw new Error(
      'Could not find blocks matching <!-- ncu-team-sync.team($org/$team)>'
    );
  }

  const RE_CLONE = new RegExp(RE.source, 'mg');
  const newContent = content.replace(RE_CLONE,
    (match, org, team, offset, string) => blocks.get(key(org, team))
  );

  return newContent;
};
