import { readFile, writeFile } from './file.js';
import { ascending } from './utils.js';

const TEAM_QUERY = 'Team';

function byLogin(a, b) {
  return ascending(a.login.toLowerCase(), b.login.toLowerCase());
}

function getContact({ login, url, name, email }) {
  if (!name) return `- [@${login}](${url})`;
  return `- [@${login}](${url}) - ${name}`;
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

  async getMemberContacts() {
    const members = await this.getMembers();
    return members.map(getContact).join('\n');
  }

  async listMembers() {
    const contacts = await this.getMemberContacts();
    this.cli.log(contacts);
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
