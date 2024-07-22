import {
  NEXT_SECURITY_RELEASE_FOLDER,
  NEXT_SECURITY_RELEASE_REPOSITORY,
  checkoutOnSecurityReleaseBranch,
  checkRemote,
  commitAndPushVulnerabilitiesJSON,
  validateDate,
  pickReport,
  getReportSeverity,
  getSummary
} from './security-release/security-release.js';
import fs from 'node:fs';
import path from 'node:path';
import auth from './auth.js';
import Request from './request.js';
import nv from '@pkgjs/nv';

export default class UpdateSecurityRelease {
  repository = NEXT_SECURITY_RELEASE_REPOSITORY;
  constructor(cli) {
    this.cli = cli;
  }

  async sync() {
    checkRemote(this.cli, this.repository);

    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    const credentials = await auth({
      github: true,
      h1: true
    });
    const req = new Request(credentials);
    for (let i = 0; i < content.reports.length; ++i) {
      const report = content.reports[i];
      const { data } = await req.getReport(report.id);
      const reportSeverity = getReportSeverity(data);
      const summaryContent = getSummary(data);
      const link = `https://hackerone.com/reports/${report.id}`;
      let prURL = report.prURL;
      if (data.relationships.custom_field_values.data.length) {
        prURL = data.relationships.custom_field_values.data[0].attributes.value;
      }

      content.reports[i] = {
        ...report,
        title: data.attributes.title,
        cveIds: data.attributes.cve_ids,
        severity: reportSeverity,
        summary: summaryContent ?? report.summary,
        link,
        prURL
      };
    }
    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));
    this.cli.ok('Synced vulnerabilities.json with HackerOne');
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
    const updatedVulnerabilitiesFiles = await this.updateJSONReleaseDate(releaseDate, { cli });

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

  async updateJSONReleaseDate(releaseDate) {
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    content.releaseDate = releaseDate;

    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));

    this.cli.ok(`Updated the release date in vulnerabilities.json: ${releaseDate}`);
    return [vulnerabilitiesJSONPath];
  }

  async addReport(reportId) {
    const credentials = await auth({
      github: true,
      h1: true
    });

    const req = new Request(credentials);
    // checkout on the next-security-release branch
    checkoutOnSecurityReleaseBranch(this.cli, this.repository);

    // get h1 report
    const { data: report } = await req.getReport(reportId);
    const entry = await pickReport(report, { cli: this.cli, req });

    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    content.reports.push(entry);
    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));
    this.cli.ok(`Updated vulnerabilities.json with the report: ${entry.id}`);
    const commitMessage = `chore: added report ${entry.id} to vulnerabilities.json`;
    commitAndPushVulnerabilitiesJSON(vulnerabilitiesJSONPath,
      commitMessage, { cli: this.cli, repository: this.repository });
    this.cli.ok('Done!');
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

  async requestCVEs() {
    const credentials = await auth({
      github: true,
      h1: true
    });
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    const { reports } = content;
    const req = new Request(credentials);
    const programId = await this.getNodeProgramId(req);
    const cves = await this.promptCVECreation(req, reports, programId);
    this.assignCVEtoReport(cves, reports);
    this.updateVulnerabilitiesJSON(content, vulnerabilitiesJSONPath);
    this.updateHackonerReportCve(req, reports);
  }

  assignCVEtoReport(cves, reports) {
    for (const cve of cves) {
      const report = reports.find(report => report.id === cve.reportId);
      report.cveIds = [cve.cve_identifier];
    }
  }

  async updateHackonerReportCve(req, reports) {
    for (const report of reports) {
      const { id, cveIds } = report;
      this.cli.startSpinner(`Updating report ${id} with CVEs ${cveIds}..`);
      const body = {
        data: {
          type: 'report-cves',
          attributes: {
            cve_ids: cveIds
          }
        }
      };
      const response = await req.updateReportCVE(id, body);
      if (response.errors) {
        this.cli.error(`Error updating report ${id}`);
        this.cli.error(JSON.stringify(response.errors, null, 2));
      }
      this.cli.stopSpinner(`Done updating report ${id} with CVEs ${cveIds}..`);
    }
  }

  updateVulnerabilitiesJSON(content, vulnerabilitiesJSONPath) {
    this.cli.startSpinner(`Updating vulnerabilities.json from\
     ${vulnerabilitiesJSONPath}..`);
    const filePath = path.resolve(vulnerabilitiesJSONPath);
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    // push the changes to the repository
    commitAndPushVulnerabilitiesJSON(filePath,
      'chore: updated vulnerabilities.json with CVEs',
      { cli: this.cli, repository: this.repository });
    this.cli.stopSpinner(`Done updating vulnerabilities.json from ${filePath}`);
  }

  async promptCVECreation(req, reports, programId) {
    const supportedVersions = (await nv('supported'));
    const cves = [];
    for (const report of reports) {
      const { id, summary, title, affectedVersions, cveIds, link } = report;
      // skip if already has a CVE
      // risky because the CVE associated might be
      // mentioned in the report and not requested by Node
      if (cveIds?.length) continue;

      let severity = report.severity;

      if (!severity.cvss_vector_string || !severity.weakness_id) {
        try {
          const h1Report = await req.getReport(id);
          if (!h1Report.data.relationships.severity?.data.attributes.cvss_vector_string) {
            throw new Error('No severity found');
          }
          severity = {
            weakness_id: h1Report.data.relationships.weakness?.data.id,
            cvss_vector_string:
              h1Report.data.relationships.severity?.data.attributes.cvss_vector_string,
            rating: h1Report.data.relationships.severity?.data.attributes.rating
          };
        } catch (error) {
          this.cli.error(`Couldnt not retrieve severity from report ${id}, skipping...`);
          continue;
        }
      }

      const { cvss_vector_string, weakness_id } = severity;

      const create = await this.cli.prompt(
        `Request a CVE for: \n
Title: ${title}\n
Link: ${link}\n
Affected versions: ${affectedVersions.join(', ')}\n
Vector: ${cvss_vector_string}\n
Summary: ${summary}\n`,
        { defaultAnswer: true });

      if (!create) continue;

      const body = {
        data: {
          type: 'cve-request',
          attributes: {
            team_handle: 'nodejs-team',
            versions: await this.formatAffected(affectedVersions, supportedVersions),
            metrics: [
              {
                vectorString: cvss_vector_string
              }
            ],
            weakness_id: Number(weakness_id),
            description: title,
            vulnerability_discovered_at: new Date().toISOString()
          }
        }
      };
      const { data } = await req.requestCVE(programId, body);
      if (data.errors) {
        this.cli.error(`Error requesting CVE for report ${id}`);
        this.cli.error(JSON.stringify(data.errors, null, 2));
        continue;
      }
      const { cve_identifier } = data.attributes;
      cves.push({ cve_identifier, reportId: id });
    }
    return cves;
  }

  async getNodeProgramId(req) {
    const programs = await req.getPrograms();
    const { data } = programs;
    for (const program of data) {
      const { attributes } = program;
      if (attributes.handle === 'nodejs') {
        return program.id;
      }
    }
  }

  async formatAffected(affectedVersions, supportedVersions) {
    const result = [];
    for (const affectedVersion of affectedVersions) {
      const major = affectedVersion.split('.')[0];
      const latest = supportedVersions.find((v) => v.major === Number(major)).version;
      const version = await this.cli.prompt(
        `What is the affected version (<=) for release line ${affectedVersion}?`,
        { questionType: 'input', defaultAnswer: latest });
      result.push({
        vendor: 'nodejs',
        product: 'node',
        func: '<=',
        version,
        versionType: 'semver',
        affected: true
      });
    }
    return result;
  }
}
