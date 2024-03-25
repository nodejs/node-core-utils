import {
  NEXT_SECURITY_RELEASE_REPOSITORY,
  checkoutOnSecurityReleaseBranch,
  getVulnerabilitiesJSON,
  validateDate
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

    this.createDockerNodeIssue(releaseDate);
  }

  async createDockerNodeIssue(releaseDate) {
    const create = await this.cli.prompt(
      'Create an issue in https://github.com/nodejs/docker-node to announce the security release?',
      { defaultAnswer: true });

    if (!create) {
      this.cli.info('DockerNode issue creation skipped');
    }

    const repository = {
      owner: 'nodejs',
      repo: 'docker-node'
    };

    const title = `Heads up on upcoming Node.js security\
 release planned for ${releaseDate.toISOString().split('T')[0]}`;
    const content = 'As per security release workflow,' +
      ' creating issue to give docker team a heads up.';

    await this.createIssue(title, content, repository);
  }

  async createIssue(title, content, repository) {
    const data = await this.req.createIssue(title, content, repository);
    if (data.html_url) {
      this.cli.ok(`Created: ${data.html_url}`);
    } else {
      this.cli.error(data);
      process.exit(1);
    }
  }
}
