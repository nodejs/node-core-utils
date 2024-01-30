import {
  NEXT_SECURITY_RELEASE_FOLDER,
  NEXT_SECURITY_RELEASE_REPOSITORY,
  checkoutOnSecurityReleaseBranch,
  commitAndPushVulnerabilitiesJSON,
  getSupportedVersions,
  getSummary,
  validateDate
} from './security-release/security-release.js';
import fs from 'node:fs';
import path from 'node:path';
import auth from './auth.js';
import Request from './request.js';

export default class UpdateSecurityRelease {
  repository = NEXT_SECURITY_RELEASE_REPOSITORY;
  constructor(cli) {
    this.cli = cli;
  }

  async updateReleaseDate(releaseDate) {
    const { cli } = this;

    try {
      validateDate(releaseDate);
    } catch (error) {
      cli.error('Invalid date format. Please use the format yyyy/mm/dd.');
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

  readVulnerabilitiesJSON(vulnerabilitiesJSONPath) {
    const exists = fs.existsSync(vulnerabilitiesJSONPath);

    if (!exists) {
      this.cli.error(`The file vulnerabilities.json does not exist at ${vulnerabilitiesJSONPath}`);
      process.exit(1);
    }

    return JSON.parse(fs.readFileSync(vulnerabilitiesJSONPath, 'utf8'));
  }

  getVulnerabilitiesJSONPath() {
    return path.join(process.cwd(),
      NEXT_SECURITY_RELEASE_FOLDER, 'vulnerabilities.json');
  }

  async updateVulnerabilitiesJSON(releaseDate) {
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    content.releaseDate = releaseDate;

    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));

    this.cli.ok(`Updated the release date in vulnerabilities.json: ${releaseDate}`);
    return [vulnerabilitiesJSONPath];
  }

  async addReport(reportId) {
    const { cli } = this;
    const credentials = await auth({
      github: true,
      h1: true
    });

    const req = new Request(credentials);
    // checkout on the next-security-release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);

    // get h1 report
    const { data: report } = await req.getReport(reportId);
    const { id, attributes: { title, cve_ids }, relationships: { severity, reporter } } = report;
    // if severity is not set on h1, set it to TBD
    const reportLevel = severity ? severity.data.attributes.rating : 'TBD';

    // get the affected versions
    const supportedVersions = await getSupportedVersions();
    const versions = await cli.prompt('Which active release lines this report affects?', {
      questionType: 'input',
      defaultAnswer: supportedVersions
    });

    // get the team summary from h1 report
    const summaryContent = await getSummary(id, req);

    const entry = {
      id,
      title,
      cve_ids,
      severity: reportLevel,
      summary: summaryContent ?? '',
      affectedVersions: versions.split(',').map((v) => v.replace('v', '').trim()),
      reporter: reporter.data.attributes.username
    };

    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    content.reports.push(entry);
    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));
    this.cli.ok(`Updated vulnerabilities.json with the report: ${id}`);
    const commitMessage = `chore: added report ${id} to vulnerabilities.json`;
    commitAndPushVulnerabilitiesJSON(vulnerabilitiesJSONPath,
      commitMessage, { cli, repository: this.repository });
    cli.ok('Done!');
  }

  removeReport(reportId) {
    const { cli } = this;
    // checkout on the next-security-release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    const found = content.reports.some((report) => report.id === reportId);
    if (!found) {
      cli.error(`Report with id ${reportId} not found in vulnerabilities.json`);
      process.exit(1);
    }
    content.reports = content.reports.filter((report) => report.id !== reportId);
    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));
    this.cli.ok(`Updated vulnerabilities.json with the report: ${reportId}`);

    const commitMessage = `chore: remove report ${reportId} from vulnerabilities.json`;
    commitAndPushVulnerabilitiesJSON(vulnerabilitiesJSONPath,
      commitMessage, { cli, repository: this.repository });
    cli.ok('Done!');
  }
}
