import path from 'node:path';
import fs from 'node:fs';
import auth from './auth.js';
import Request from './request.js';
import { NEXT_SECURITY_RELEASE_FOLDER } from './security-release/security-release.js';
import nv from '@pkgjs/nv';

export default class HackerOneCve {
  constructor(cli) {
    this.cli = cli;
    this.jsonPath = path.join(process.cwd(),
      NEXT_SECURITY_RELEASE_FOLDER, 'vulnerabilities.json');
  }

  async requestCVEs() {
    const { cli } = this;

    const credentials = await auth({
      github: true,
      h1: true
    });

    const vulnerabilitiesJSON = this.getVulnerabilitiesJSON(cli);
    const { reports } = vulnerabilitiesJSON;
    const req = new Request(credentials);
    const programId = await this.getNodeProgramId(req);
    const cves = await this.promptCVECreation(req, reports, programId);
    this.assignCVEtoReport(cves, reports);
    this.updateVulnerabilitiesJSON(vulnerabilitiesJSON);
    this.updateHackonerReportCve(req, reports);
  }

  assignCVEtoReport(cves, reports) {
    for (const cve of cves) {
      reports.find(report => report.id === cve.reportId).cve_ids = [cve];
    }
  }

  async updateHackonerReportCve(req, reports) {
    for (const report of reports) {
      const { id, cve_ids } = report;
      const body = {
        data: {
          type: 'cve-report',
          attributes: {
            cve_ids
          }
        }
      };
      await req.updateReportCVE(id, body);
    }
  }

  updateVulnerabilitiesJSON(vulnerabilitiesJSON) {
    this.cli.startSpinner(`Updating vulnerabilities.json from ${this.jsonPath}..`);
    const filePath = path.resolve(this.jsonPath);
    fs.writeFileSync(filePath, JSON.stringify(vulnerabilitiesJSON, null, 2));
    this.cli.stopSpinner(`Done updating vulnerabilities.json from ${filePath}`);
  }

  getVulnerabilitiesJSON(cli) {
    const filePath = path.resolve(this.jsonPath);
    cli.startSpinner(`Reading vulnerabilities.json from ${filePath}..`);
    const file = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    cli.stopSpinner(`Done reading vulnerabilities.json from ${filePath}`);
    return file;
  }

  async promptCVECreation(req, reports, programId) {
    const supportedVersions = (await nv('supported'));
    const cves = [];
    for (const report of reports) {
      const { id, summary, title, affectedVersions } = report;
      const h1Report = await req.getReport(id);
      const weaknessId = h1Report.data.relationships.weakness?.data.id;
      const vectorString = h1Report.data.relationships.severity?.data.attributes.cvss_vector_string;
      const discoveredAt = h1Report.data.attributes.created_at;

      const create = await this.cli.prompt(
        `Request a CVE for: \n
Title: ${title}\n
Affected versions: ${affectedVersions.join(', ')}\n
Vector: ${vectorString}\n
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
                vectorString
              }
            ],
            weakness_id: Number(weaknessId),
            description: title,
            vulnerability_discovered_at: discoveredAt
          }
        }
      };
      const { attributes } = await req.requestCVE(programId, body);
      const { cve_identifier } = attributes;
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
