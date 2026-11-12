import fs from 'node:fs';
import {
  checkoutOnSecurityReleaseBranch,
  checkRemote,
  stageSecurityReleaseChanges,
  validateDate,
  pickReport,
  getAffectedVersionLines,
  getReportSeverity,
  getSummary,
  confirmSecurityStep,
  SecurityRelease
} from './security-release/security-release.js';
import auth from './auth.js';
import Request from './request.js';
import nv from '@pkgjs/nv';
import semver from 'semver';
import { incrementVersion } from './release/utils.js';
import { getMergedConfig } from './config.js';

export const CVE_SOURCES = ['hackerone', 'openjs-cna'];
const DEFAULT_CNA_TIMEOUT_SECONDS = 600;

// `cve_source` picks who issues CVE ids: HackerOne (the default, unchanged
// behaviour) or the OpenJS Foundation CNA. HackerOne stays the bug-bounty
// source either way and is updated with the resulting id.
export function resolveCveSource(config = {}) {
  const { cve_source: cveSource } = config;
  if (cveSource === undefined || cveSource === null || cveSource === '') {
    return 'hackerone';
  }
  if (!CVE_SOURCES.includes(cveSource)) {
    throw new Error(
      `Unknown cve_source "${cveSource}"; expected one of: ${CVE_SOURCES.join(', ')}`
    );
  }
  return cveSource;
}

export default class UpdateSecurityRelease extends SecurityRelease {
  getCveSource() {
    let config;
    try {
      config = getMergedConfig();
    } catch {
      config = {};
    }
    return resolveCveSource(config);
  }

  // Seconds to wait for an OpenJS CNA run before saving the correlation id
  // and giving control back. Supervised buckets wait for a coordinator, so
  // this is a pause, not a failure.
  getCnaTimeoutMs() {
    let seconds;
    try {
      ({ openjs_cna_timeout: seconds } = getMergedConfig());
    } catch {
      // fall through to the default
    }
    const parsed = Number(seconds);
    return (Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CNA_TIMEOUT_SECONDS) * 1000;
  }

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
    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));

    const commitMessage = 'chore: git node security --sync';
    await stageSecurityReleaseChanges([vulnerabilitiesJSONPath],
      commitMessage, { cli: this.cli, repository: this.repository });
    this.cli.ok('Synced vulnerabilities.json with HackerOne');
  }

  async updateReleaseDate(releaseDate) {
    const { cli } = this;

    try {
      validateDate(releaseDate);
    } catch {
      cli.error('Invalid date format. Please use the format yyyy/mm/dd.');
      process.exit(1);
    }

    // checkout on the next-security-release branch
    await checkoutOnSecurityReleaseBranch(cli, this.repository);

    // update the release date in the vulnerabilities.json file
    const updatedVulnerabilitiesFiles = await this.updateJSONReleaseDate(releaseDate, { cli });

    const commitMessage = `chore: update the release date to ${releaseDate}`;
    await stageSecurityReleaseChanges(updatedVulnerabilitiesFiles,
      commitMessage, { cli, repository: this.repository });
    cli.ok('Done!');
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
    await checkoutOnSecurityReleaseBranch(this.cli, this.repository);

    // get h1 report
    const { data: report } = await req.getReport(reportId);
    const entry = await pickReport(report, { cli: this.cli, req });

    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    content.reports.push(entry);
    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));
    this.cli.ok(`Updated vulnerabilities.json with the report: ${entry.id}`);
    const commitMessage = `chore: added report ${entry.id} to vulnerabilities.json`;
    await stageSecurityReleaseChanges(vulnerabilitiesJSONPath,
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
    fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));
    this.cli.ok(`Updated vulnerabilities.json with the report: ${reportId}`);

    const commitMessage = `chore: remove report ${reportId} from vulnerabilities.json`;
    await stageSecurityReleaseChanges(vulnerabilitiesJSONPath,
      commitMessage, { cli, repository: this.repository });
    cli.ok('Done!');
  }

  async requestCVEs() {
    const cveSource = this.getCveSource();
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    const { reports } = content;
    this.validateReportsForCVE(reports);

    // A pending OpenJS reservation must be resumed through the CNA even if
    // the operator flipped `cve_source` back to HackerOne in the meantime.
    const hasPending = reports.some((report) => report.pendingCve?.correlationId);
    const credentials = await auth({
      github: true,
      h1: true,
      cna: cveSource === 'openjs-cna' || hasPending
    });
    const req = new Request(credentials);
    if (cveSource === 'openjs-cna') {
      this.cli.info(
        `Requesting CVEs through the OpenJS Foundation CNA (${credentials.cna.worker_url})`
      );
    }
    const programId = cveSource === 'hackerone'
      ? await this.getNodeProgramId(req)
      : undefined;
    await this.promptCVECreation(req, reports, programId, content, cveSource);
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

  async promptCVECreation(req, reports, programId, content, cveSource = 'hackerone') {
    const reportsWithoutCVE = reports.filter((report) => !report.cveIds?.length);
    if (!reportsWithoutCVE.length) {
      this.cli.info('All reports already have a CVE.');
      return;
    }
    this.showCVERequestSummary(reportsWithoutCVE);
    await confirmSecurityStep(
      this.cli,
      `request CVEs for ${reportsWithoutCVE.length} HackerOne reports`,
      (cveSource === 'openjs-cna'
        ? 'This reserves a CVE through the OpenJS Foundation CNA for each report'
        : 'This submits a CVE request to HackerOne for each report') +
        ', adds each CVE ID to its HackerOne report, then updates vulnerabilities.json.'
    );

    const supportedVersions = (await nv('supported'));
    const eolVersions = (await nv('eol'));
    const versionCache = new Map();
    const { successfulReports, h1Failed } = await this.collectSuccessfulCVERequests({
      req,
      reports,
      programId,
      supportedVersions,
      eolVersions,
      versionCache,
      content,
      cveSource
    });

    if (!successfulReports.length) {
      this.cli.warn('No CVE requests succeeded.');
      return;
    }

    await this.applySuccessfulCVEUpdates(content, successfulReports, h1Failed);
  }

  showCVERequestSummary(reports) {
    this.cli.info(`Reports selected for CVE requests (${reports.length}):`);
    for (const { id, severity, title } of reports) {
      const rating = severity?.rating || 'unknown';
      this.cli.info(`- ${id} [${rating}] ${title}`);
    }
  }

  async collectSuccessfulCVERequests({
    req,
    reports,
    programId,
    supportedVersions,
    eolVersions,
    versionCache,
    content,
    cveSource = 'hackerone'
  }) {
    const successfulReports = [];
    const h1Failed = [];
    try {
      for (const report of reports) {
        const requested = await this.requestReportCVE({
          req,
          report,
          programId,
          supportedVersions,
          eolVersions,
          versionCache,
          content,
          cveSource
        });
        if (!requested) continue;
        successfulReports.push(report);
        // Update HackerOne before vulnerabilities.json so that `--sync` can
        // recover the CVE IDs if the local update does not happen.
        if (!await this.updateHackonerReportCve(req, report)) {
          h1Failed.push(report);
        }
      }
    } catch (error) {
      if (!this.isPromptInterrupted(error)) throw error;
      this.cli.warn('CVE request interrupted. Finalizing successful requests.');
    }
    return { successfulReports, h1Failed };
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
    content,
    cveSource = 'hackerone'
  }) {
    const { id, affectedVersions, cveIds } = report;
    const affectedVersionLines = getAffectedVersionLines(affectedVersions);
    // skip if already has a CVE
    // risky because the CVE associated might be
    // mentioned in the report and not requested by Node
    if (cveIds?.length) return false;

    // A previous run dispatched the reservation but did not see it complete
    // (typically a supervised bucket waiting for a coordinator). Pick it up
    // instead of reserving a second id.
    if (report.pendingCve?.correlationId) {
      this.cli.info(
        `Resuming pending OpenJS CNA reservation for report ${id} ` +
        `(correlation id ${report.pendingCve.correlationId})`
      );
      return this.waitForReservedCve({ req, report, content });
    }

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
      } catch {
        this.cli.error(`Couldnt not retrieve severity from report ${id}, skipping...`);
        return false;
      }
    }

    const { cvss_vector_string, weakness_id } = severity;

    const { h1AffectedVersions, patchedVersions } =
      await this.calculateVersions(
        affectedVersionLines,
        supportedVersions,
        eolVersions,
        versionCache
      );

    if (cveSource === 'openjs-cna') {
      return this.reserveCveViaOpenJsCna({ req, report, content, patchedVersions });
    }

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

  // Dispatches `reserve-cve` and saves the correlation id to
  // vulnerabilities.json BEFORE waiting, so a timeout (or Ctrl-C) never
  // orphans a reserved id: re-running --request-cve resumes from the file.
  async reserveCveViaOpenJsCna({ req, report, content, patchedVersions }) {
    const { id } = report;
    this.cli.startSpinner(`Reserving a CVE for report ${id} through the OpenJS CNA...`);
    let dispatch;
    try {
      dispatch = await req.cnaDispatch('reserve-cve');
    } catch (error) {
      this.cli.stopSpinner(
        `Error reserving a CVE for report ${id}`,
        this.cli.SPINNER_STATUS.FAILED
      );
      this.cli.error(error);
      return false;
    }
    report.pendingCve = {
      correlationId: dispatch.correlation_id,
      dispatchedAt: new Date().toISOString(),
      patchedVersions
    };
    this.cli.stopSpinner(
      `Dispatched reserve-cve for report ${id} (correlation id ${dispatch.correlation_id})`
    );
    await this.persistPendingCve(content, report);
    return this.waitForReservedCve({ req, report, content });
  }

  // Writes vulnerabilities.json locally so the `pendingCve` marker survives an
  // interrupted run. It is staged with the regular post-request update.
  persistPendingCve(content) {
    fs.writeFileSync(this.getVulnerabilitiesJSONPath(), JSON.stringify(content, null, 2));
  }

  async waitForReservedCve({ req, report, content }) {
    const { id, pendingCve } = report;
    const { correlationId } = pendingCve;
    this.cli.startSpinner(
      `Waiting for the OpenJS CNA to reserve a CVE for report ${id} (${correlationId})...`
    );
    let run;
    try {
      run = await req.cnaWaitForCompletion(correlationId, {
        timeoutMs: this.getCnaTimeoutMs()
      });
    } catch (error) {
      this.cli.stopSpinner(
        `CVE reservation for report ${id} did not complete`,
        this.cli.SPINNER_STATUS.FAILED
      );
      if (error.name === 'CnaTimeoutError') {
        // Keep pendingCve: the run is still going on the server side.
        this.cli.warn(
          `Still waiting on ${correlationId} (supervised buckets wait for a ` +
          'coordinator approval). The correlation id is saved in ' +
          'vulnerabilities.json; re-run `git node security --request-cve` to resume.'
        );
        return false;
      }
      // The run concluded without a CVE: drop the marker so the next attempt
      // dispatches a fresh reservation.
      this.cli.error(error);
      delete report.pendingCve;
      await this.persistPendingCve(content, report);
      return false;
    }

    const cveId = run.result?.cve_id;
    if (!cveId) {
      this.cli.stopSpinner(
        `Reservation for report ${id} completed without a CVE id`,
        this.cli.SPINNER_STATUS.FAILED
      );
      this.cli.error(
        `Run ${correlationId} succeeded but returned no cve_id. ` +
        `Inspect ${run.url ?? 'the run'} with an OpenJS CNA coordinator before retrying.`
      );
      delete report.pendingCve;
      await this.persistPendingCve(content, report);
      return false;
    }

    report.cveIds = [cveId];
    report.patchedVersions = pendingCve.patchedVersions;
    delete report.pendingCve;
    this.cli.stopSpinner(`Reserved ${cveId} for report ${id}`);
    return true;
  }

  async applySuccessfulCVEUpdates(content, successfulReports, h1Failed = []) {
    this.cli.info('CVE requests succeeded:');
    for (const { id, cveIds } of successfulReports) {
      this.cli.info(`- ${id}: ${cveIds.join(', ')}`);
    }
    if (h1Failed.length) {
      this.cli.warn('HackerOne reports not updated:');
      for (const { id, cveIds } of h1Failed) {
        this.cli.warn(`- ${id}: ${cveIds.join(', ')}`);
      }
    }

    const vulnerabilitiesUpdated = await this.updateVulnerabilitiesJSON(content);
    if (!vulnerabilitiesUpdated) {
      this.cli.warn('vulnerabilities.json was not updated. Run `git node security --sync` ' +
        'to fetch the CVE IDs from HackerOne.');
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
        const latest =
          supportedVersions.find((v) => v.major === Number(affectedMajor))?.version ?? '';
        const version = await this.cli.prompt(
          `What is the affected version (<=) for release line ${affectedVersion}?`,
          { questionType: 'input', defaultAnswer: latest });

        const nextPatchVersion = incrementVersion(version, 'patch');
        const nextMinorVersion = incrementVersion(version, 'minor');
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
