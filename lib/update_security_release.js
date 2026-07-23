import {
  checkoutOnSecurityReleaseBranch,
  checkRemote,
  commitAndPushVulnerabilitiesJSON,
  validateDate,
  pickReport,
  getAffectedVersionLines,
  getReportSeverity,
  getSummary,
  confirmSecurityStep,
  writeSecurityFile,
  SecurityRelease
} from './security-release/security-release.js';
import auth from './auth.js';
import Request from './request.js';
import nv from '@pkgjs/nv';
import semver from 'semver';

export default class UpdateSecurityRelease extends SecurityRelease {
  async sync() {
    await checkRemote(this.cli, this.repository);

    const content = this.readVulnerabilitiesJSON();
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
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    await writeSecurityFile(
      this.cli,
      vulnerabilitiesJSONPath,
      JSON.stringify(content, null, 2),
      'This writes synchronized HackerOne report data to vulnerabilities.json.'
    );

    const commitMessage = 'chore: git node security --sync';
    await commitAndPushVulnerabilitiesJSON([vulnerabilitiesJSONPath],
      commitMessage, { cli: this.cli, repository: this.repository });
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
    await checkoutOnSecurityReleaseBranch(cli, this.repository);

    // update the release date in the vulnerabilities.json file
    const updatedVulnerabilitiesFiles = await this.updateJSONReleaseDate(releaseDate, { cli });

    const commitMessage = `chore: update the release date to ${releaseDate}`;
    await commitAndPushVulnerabilitiesJSON(updatedVulnerabilitiesFiles,
      commitMessage, { cli, repository: this.repository });
    cli.ok('Done!');
  }

  async updateJSONReleaseDate(releaseDate) {
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    content.releaseDate = releaseDate;

    await writeSecurityFile(
      this.cli,
      vulnerabilitiesJSONPath,
      JSON.stringify(content, null, 2),
      `This sets releaseDate to ${releaseDate} in vulnerabilities.json.`
    );

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
    await checkoutOnSecurityReleaseBranch(this.cli, this.repository);

    // get h1 report
    const { data: report } = await req.getReport(reportId);
    const entry = await pickReport(report, { cli: this.cli, req });

    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    content.reports.push(entry);
    await writeSecurityFile(
      this.cli,
      vulnerabilitiesJSONPath,
      JSON.stringify(content, null, 2),
      `This appends HackerOne report ${entry.id} to vulnerabilities.json.`
    );
    this.cli.ok(`Updated vulnerabilities.json with the report: ${entry.id}`);
    const commitMessage = `chore: added report ${entry.id} to vulnerabilities.json`;
    await commitAndPushVulnerabilitiesJSON(vulnerabilitiesJSONPath,
      commitMessage, { cli: this.cli, repository: this.repository });
    this.cli.ok('Done!');
  }

  async removeReport(reportId) {
    const { cli } = this;
    // checkout on the next-security-release branch
    await checkoutOnSecurityReleaseBranch(cli, this.repository);
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    const found = content.reports.some((report) => report.id === reportId);
    if (!found) {
      cli.error(`Report with id ${reportId} not found in vulnerabilities.json`);
      process.exit(1);
    }
    content.reports = content.reports.filter((report) => report.id !== reportId);
    await writeSecurityFile(
      this.cli,
      vulnerabilitiesJSONPath,
      JSON.stringify(content, null, 2),
      `This removes HackerOne report ${reportId} from vulnerabilities.json.`
    );
    this.cli.ok(`Updated vulnerabilities.json with the report: ${reportId}`);

    const commitMessage = `chore: remove report ${reportId} from vulnerabilities.json`;
    await commitAndPushVulnerabilitiesJSON(vulnerabilitiesJSONPath,
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
    this.validateReportsForCVE(reports);
    const req = new Request(credentials);
    const programId = await this.getNodeProgramId(req);
    await this.promptCVECreation(req, reports, programId, content);
  }

  validateReportsForCVE(reports) {
    const invalid = [];
    for (const report of reports) {
      if (report.cveIds?.length) continue;
      const missing = [];
      if (!report.summary) missing.push('description');
      if (!report.severity?.weakness_id) missing.push('weakness_id');
      if (!report.severity?.cvss_vector_string) missing.push('cvss_vector_string');
      if (missing.length) {
        invalid.push({ id: report.id, missing });
      }
    }
    if (invalid.length) {
      for (const { id, missing } of invalid) {
        this.cli.error(`Report ${id} is missing: ${missing.join(', ')}`);
      }
      throw new Error('Some reports are missing required fields for CVE request. ' +
        'Run `git node security --sync` to update them.');
    }
  }

  async updateHackonerReportCve(req, report) {
    const { id, cveIds } = report;
    await confirmSecurityStep(
      this.cli,
      `update HackerOne report \`${id}\` with CVEs ${cveIds}`,
      'This writes the assigned CVE IDs back to the HackerOne report.'
    );
    return this.updateHackonerReportCveWithoutConfirmation(req, report);
  }

  async updateHackonerReportCveWithoutConfirmation(req, report) {
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
    try {
      const response = await req.updateReportCVE(id, body);
      if (response.errors) {
        this.cli.stopSpinner(
          `Error updating report ${id}`,
          this.cli.SPINNER_STATUS.FAILED
        );
        this.cli.error(`Error updating report ${id}`);
        this.cli.error(JSON.stringify(response.errors, null, 2));
        return false;
      }
      this.cli.stopSpinner(`Done updating report ${id} with CVEs ${cveIds}..`);
      return true;
    } catch (error) {
      this.cli.stopSpinner(
        `Error updating report ${id}`,
        this.cli.SPINNER_STATUS.FAILED
      );
      this.cli.error(error);
      return false;
    }
  }

  async promptCVECreation(req, reports, programId, content) {
    const reportsWithoutCVE = reports.filter((report) => !report.cveIds?.length);
    const requestAll = await this.promptRequestAllCVEs(reportsWithoutCVE);

    if (requestAll) {
      await confirmSecurityStep(
        this.cli,
        `request CVEs for ${reportsWithoutCVE.length} HackerOne reports`,
        'This submits CVE requests to HackerOne for every report without a CVE.'
      );
    }

    const supportedVersions = (await nv('supported'));
    const eolVersions = (await nv('eol'));
    const versionCache = new Map();
    const successfulReports = await this.collectSuccessfulCVERequests({
      req,
      reports,
      programId,
      supportedVersions,
      eolVersions,
      versionCache,
      requestAll
    });

    if (!successfulReports.length) {
      this.cli.warn('No CVE requests succeeded.');
      return;
    }

    await this.applySuccessfulCVEUpdates(req, content, successfulReports);
  }

  showCVERequestSummary(reports) {
    this.cli.info(`Reports selected for CVE requests (${reports.length}):`);
    for (const { id, severity, title } of reports) {
      const rating = severity?.rating || 'unknown';
      this.cli.info(`- ${id} [${rating}] ${title}`);
    }
  }

  promptRequestAllCVEs(reportsWithoutCVE) {
    if (reportsWithoutCVE.length <= 1) return false;
    this.showCVERequestSummary(reportsWithoutCVE);
    return this.cli.prompt(
      'Request CVEs for all reports without prompting for each report?',
      { defaultAnswer: false }
    );
  }

  async collectSuccessfulCVERequests({
    req,
    reports,
    programId,
    supportedVersions,
    eolVersions,
    versionCache,
    requestAll
  }) {
    const successfulReports = [];
    try {
      for (const report of reports) {
        const requested = await this.requestReportCVE({
          req,
          report,
          programId,
          supportedVersions,
          eolVersions,
          versionCache,
          requestAll
        });
        if (requested) successfulReports.push(report);
      }
    } catch (error) {
      if (!this.isPromptInterrupted(error)) throw error;
      this.cli.warn('CVE request interrupted. Finalizing successful requests.');
    }
    return successfulReports;
  }

  isPromptInterrupted(error) {
    return error?.name === 'ExitPromptError' ||
      error?.name === 'AbortPromptError' ||
      error?.message?.includes('User force closed');
  }

  async requestReportCVE({
    req,
    report,
    programId,
    supportedVersions,
    eolVersions,
    versionCache,
    requestAll
  }) {
    const { id, summary, title, affectedVersions, cveIds, link } = report;
    const affectedVersionLines = getAffectedVersionLines(affectedVersions);
    // skip if already has a CVE
    // risky because the CVE associated might be
    // mentioned in the report and not requested by Node
    if (cveIds?.length) return false;

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
        return false;
      }
    }

    const { cvss_vector_string, weakness_id } = severity;

    const create = requestAll || await this.cli.prompt(
      `Request a CVE for: \n
Title: ${title}\n
Link: ${link}\n
Affected versions: ${affectedVersionLines.join(', ')}\n
Vector: ${cvss_vector_string}\n
Summary: ${summary}\n`,
      { defaultAnswer: true });

    if (!create) return false;

    const { h1AffectedVersions, patchedVersions } =
      await this.calculateVersions(
        affectedVersionLines,
        supportedVersions,
        eolVersions,
        versionCache
      );
    const body = {
      data: {
        type: 'cve-request',
        attributes: {
          team_handle: 'nodejs-team',
          versions: h1AffectedVersions,
          metrics: [
            {
              vectorString: cvss_vector_string
            }
          ],
          auto_submit_on_publicly_disclosing_report: true,
          references: ['https://nodejs.org/en/blog/vulnerability'],
          report_id: report.id,
          weakness_id: Number(weakness_id),
          description: report.summary,
          vulnerability_discovered_at: new Date().toISOString()
        }
      }
    };
    if (!requestAll) {
      await confirmSecurityStep(
        this.cli,
        `request CVE for HackerOne report \`${report.id}\``,
        'This submits a CVE request to HackerOne for the selected report.'
      );
    }
    this.cli.startSpinner(`Requesting CVE for report ${id}...`);
    let response;
    try {
      response = await req.requestCVE(programId, body);
    } catch (error) {
      this.cli.stopSpinner(
        `Error requesting CVE for report ${id}`,
        this.cli.SPINNER_STATUS.FAILED
      );
      this.cli.error(error);
      return false;
    }
    if (response.errors) {
      this.cli.stopSpinner(
        `Error requesting CVE for report ${id}`,
        this.cli.SPINNER_STATUS.FAILED
      );
      this.cli.error(`Error requesting CVE for report ${id}`);
      this.cli.error(JSON.stringify(response.errors, null, 2));
      return false;
    }
    this.cli.stopSpinner(`Requested CVE for report ${id}`);
    const { cve_identifier } = response.data.attributes;
    report.cveIds = [cve_identifier];
    report.patchedVersions = patchedVersions;
    return true;
  }

  async applySuccessfulCVEUpdates(req, content, successfulReports) {
    this.cli.info('CVE requests succeeded:');
    for (const { id, cveIds } of successfulReports) {
      this.cli.info(`- ${id}: ${cveIds.join(', ')}`);
    }
    const updateVulnerabilitiesJSON = await this.cli.prompt(
      'Update vulnerabilities.json with the successful CVE requests?',
      { defaultAnswer: true }
    );
    if (!updateVulnerabilitiesJSON) {
      this.cli.warn(
        'Skipping HackerOne updates because vulnerabilities.json was not updated.'
      );
      return;
    }

    const vulnerabilitiesUpdated = await this.updateVulnerabilitiesJSON(content);
    if (!vulnerabilitiesUpdated) {
      this.cli.warn('Skipping HackerOne updates because vulnerabilities.json update failed.');
      return;
    }

    const updateHackerOne = await this.cli.prompt(
      'Update HackerOne reports with the successful CVE IDs?',
      { defaultAnswer: true }
    );
    if (updateHackerOne) {
      await confirmSecurityStep(
        this.cli,
        `update ${successfulReports.length} HackerOne reports with CVE IDs`,
        'This writes the assigned CVE IDs back to all successful HackerOne reports.'
      );
      const h1Succeeded = [];
      const h1Failed = [];
      for (const report of successfulReports) {
        try {
          const updated = await this.updateHackonerReportCveWithoutConfirmation(req, report);
          if (updated) {
            h1Succeeded.push(report);
          } else {
            h1Failed.push(report);
          }
        } catch (error) {
          this.cli.error(error);
          h1Failed.push(report);
        }
      }

      if (h1Succeeded.length) {
        this.cli.info('HackerOne reports updated:');
        for (const { id, cveIds } of h1Succeeded) {
          this.cli.info(`- ${id}: ${cveIds.join(', ')}`);
        }
      }
      if (h1Failed.length) {
        this.cli.warn('HackerOne reports not updated:');
        for (const { id, cveIds } of h1Failed) {
          this.cli.warn(`- ${id}: ${cveIds.join(', ')}`);
        }
      }
    }
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

  async calculateVersions(
    affectedVersions,
    supportedVersions,
    eolVersions,
    versionCache = new Map()
  ) {
    affectedVersions = getAffectedVersionLines(affectedVersions);
    const h1AffectedVersions = [];
    const patchedVersions = [];
    let isPatchRelease = true;
    for (const affectedVersion of affectedVersions) {
      if (!versionCache.has(affectedVersion)) {
        const affectedMajor = affectedVersion.split('.')[0];
        const latest = supportedVersions.find((v) => v.major === Number(affectedMajor)).version;
        const version = await this.cli.prompt(
          `What is the affected version (<=) for release line ${affectedVersion}?`,
          { questionType: 'input', defaultAnswer: latest });

        const nextPatchVersion = semver.inc(version, 'patch');
        const nextMinorVersion = semver.inc(version, 'minor');
        const patchedVersion = await this.cli.promptRadio(
          `What is the patched version (>=) for release line ${affectedVersion}?`,
          [nextPatchVersion, nextMinorVersion],
          {
            defaultAnswer: isPatchRelease ? nextPatchVersion : nextMinorVersion
          });

        if (patchedVersion !== nextPatchVersion) {
          isPatchRelease = false; // is a minor release
        }

        versionCache.set(affectedVersion, {
          patchedVersion,
          h1AffectedVersion: {
            vendor: 'nodejs',
            product: 'node',
            func: '<=',
            version,
            versionType: 'semver',
            affected: true
          }
        });
      }

      const { h1AffectedVersion, patchedVersion } = versionCache.get(affectedVersion);
      patchedVersions.push(patchedVersion);
      h1AffectedVersions.push(h1AffectedVersion);
    }

    // All EOL versions are affected since they no longer receive security patches
    for (const eolVersion of eolVersions) {
      const version = semver.valid(eolVersion.version);
      if (version) {
        h1AffectedVersions.push({
          vendor: 'nodejs',
          product: 'node',
          func: '<=',
          version,
          versionType: 'semver',
          affected: true
        });
      }
    }

    return { h1AffectedVersions, patchedVersions };
  }
}
