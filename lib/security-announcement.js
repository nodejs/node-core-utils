import fs from 'node:fs';
import {
  NEXT_SECURITY_RELEASE_REPOSITORY,
  checkoutOnSecurityReleaseBranch,
  getVulnerabilitiesJSON,
  getVulnerabilitiesJSONPath,
  validateDate,
  formatDateToYYYYMMDD,
  commitAndPushVulnerabilitiesJSON,
  createIssue
} from './security-release/security-release.js';
import auth from './auth.js';
import Request from './request.js';

export default class SecurityAnnouncement {
  repository = NEXT_SECURITY_RELEASE_REPOSITORY;
  req;
  constructor(cli) {
    this.cli = cli;
  }

  async notifyPreRelease() {
    const { cli } = this;

    const credentials = await auth({
      github: true,
      h1: true
    });

    this.req = new Request(credentials);

    // checkout on security release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);
    // read vulnerabilities JSON file
    const content = getVulnerabilitiesJSON(cli);
    // validate the release date read from vulnerabilities JSON
    if (!content.releaseDate) {
      cli.error('Release date is not set in vulnerabilities.json,' +
        ' run `git node security --update-date=YYYY/MM/DD` to set the release date.');
      process.exit(1);
    }

    validateDate(content.releaseDate);
    const releaseDate = new Date(content.releaseDate);

    const [dockerIssue, buildIssue] = await Promise.all([
      this.createDockerNodeIssue(releaseDate),
      this.createBuildWGIssue(releaseDate)
    ]);

    content.buildIssue = buildIssue;
    content.dockerIssue = dockerIssue;

    const vulnerabilitiesJSONPath = getVulnerabilitiesJSONPath();
    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));
    const commitMessage = 'chore: add build and docker issue link';
    commitAndPushVulnerabilitiesJSON([vulnerabilitiesJSONPath],
      commitMessage, { cli: this.cli, repository: this.repository });

    this.cli.ok('Added docker and build issue in vulnerabilities.json');
  }

  async createBuildWGIssue(releaseDate) {
    const repository = {
      owner: 'nodejs',
      repo: 'build'
    };

    const { title, content } = this.createPreleaseAnnouncementIssue(releaseDate, 'build');
    return createIssue(title, content, repository, { cli: this.cli, req: this.req });
  }

  createPreleaseAnnouncementIssue(releaseDate, team) {
    const title = `[NEXT-SECURITY-RELEASE] Heads up on upcoming Node.js\
 security release ${formatDateToYYYYMMDD(releaseDate)}`;
    const content = `As per security release workflow,\
 creating issue to give the ${team} team a heads up.`;
    return { title, content };
  }

  async createDockerNodeIssue(releaseDate) {
    const repository = {
      owner: 'nodejs',
      repo: 'docker-node'
    };

    const { title, content } = this.createPreleaseAnnouncementIssue(releaseDate, 'docker');
    return createIssue(title, content, repository, { cli: this.cli, req: this.req });
  }
}
