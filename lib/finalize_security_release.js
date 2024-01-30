import {
  NEXT_SECURITY_RELEASE_FOLDER,
  NEXT_SECURITY_RELEASE_REPOSITORY,
  checkoutOnSecurityReleaseBranch,
  commitAndPushVulnerabilitiesJSON
} from './security-release/security-release.js';
import fs from 'node:fs';
import path from 'node:path';

export default class FinalizeSecurityRelease {
  repository = NEXT_SECURITY_RELEASE_REPOSITORY;
  constructor(cli) {
    this.cli = cli;
  }

  async start() {
    const { cli } = this;

    const releaseDate = await this.promptReleaseDate(cli);

    // checkout on the next-security-release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);

    // update the release date in the vulnerabilities.json file
    const updatedVulnerabilitiesFiles = await this.updateReleaseDate(releaseDate, { cli });

    const commitMessage = `chore: update the release date to ${releaseDate}`;
    commitAndPushVulnerabilitiesJSON(updatedVulnerabilitiesFiles,
      commitMessage, { cli, repository: this.repository });
    cli.ok('Done!');
  }

  async updateReleaseDate(releaseDate, { cli }) {
    const vulnerabilitiesJSONPath = path.join(process.cwd(),
      NEXT_SECURITY_RELEASE_FOLDER, 'vulnerabilities.json');

    const content = JSON.parse(fs.readFileSync(vulnerabilitiesJSONPath, 'utf8'));
    content.releaseDate = releaseDate;

    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));

    cli.ok(`Updated the release date in vulnerabilities.json: ${releaseDate}`);

    const newFolderPath = path.join(process.cwd(),
      'security-release', releaseDate.replaceAll('/', '-'));

    try {
      await fs.accessSync(newFolderPath);
    } catch (error) {
      await fs.mkdirSync(newFolderPath, { recursive: true });
    }

    const newPath = path.join(newFolderPath, 'vulnerabilities.json');

    fs.renameSync(vulnerabilitiesJSONPath, newPath);

    cli.ok(`Moved vulnerabilities.json to ${newPath}`);
    // return old path and new path to commit and push
    return [vulnerabilitiesJSONPath, newPath];
  }

  async promptReleaseDate(cli) {
    return cli.prompt('Enter the final release date in YYYY-MM-DD format:', {
      questionType: 'input',
      defaultAnswer: 'DD-MM-YYYY'
    });
  }
}
