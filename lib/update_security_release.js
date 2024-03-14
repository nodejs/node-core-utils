import {
  NEXT_SECURITY_RELEASE_FOLDER,
  NEXT_SECURITY_RELEASE_REPOSITORY,
  checkoutOnSecurityReleaseBranch,
  commitAndPushVulnerabilitiesJSON
} from './security-release/security-release.js';
import fs from 'node:fs';
import path from 'node:path';

export default class UpdateSecurityRelease {
  repository = NEXT_SECURITY_RELEASE_REPOSITORY;
  constructor(cli) {
    this.cli = cli;
  }

  async updateReleaseDate(releaseDate) {
    const { cli } = this;

    try {
      const [day, month, year] = releaseDate.split('/');
      const value = new Date(`${month}/${day}/${year}`).valueOf();
      if (Number.isNaN(value) || value < 0) {
        throw new Error('Invalid date format');
      }
    } catch (error) {
      cli.error('Invalid date format. Please use the format dd/mm/yyyy.');
      process.exit(1);
    }

    // checkout on the next-security-release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);

    // update the release date in the vulnerabilities.json file
    const updatedVulnerabilitiesFiles = await this.updateVulnerabilitiesJSON(releaseDate, { cli });

    const commitMessage = `chore: update the release date to ${releaseDate}`;
    commitAndPushVulnerabilitiesJSON(updatedVulnerabilitiesFiles,
      commitMessage, { cli, repository: this.repository });
    cli.ok('Done!');
  }

  async updateVulnerabilitiesJSON(releaseDate) {
    const vulnerabilitiesJSONPath = path.join(process.cwd(),
      NEXT_SECURITY_RELEASE_FOLDER, 'vulnerabilities.json');

    const exists = fs.existsSync(vulnerabilitiesJSONPath);

    if (!exists) {
      this.cli.error(`The file vulnerabilities.json does not exist at ${vulnerabilitiesJSONPath}`);
      process.exit(1);
    }

    const content = JSON.parse(fs.readFileSync(vulnerabilitiesJSONPath, 'utf8'));
    content.releaseDate = releaseDate;

    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));

    this.cli.ok(`Updated the release date in vulnerabilities.json: ${releaseDate}`);
    return [vulnerabilitiesJSONPath];
  }
}
