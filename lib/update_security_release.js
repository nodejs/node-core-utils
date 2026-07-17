import {
  checkoutOnSecurityReleaseBranch,
  checkRemote,
  commitAndPushVulnerabilitiesJSON,
  validateDate,
  pickReport,
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
import { getMergedConfig } from './config.js';

// Read once from .ncurc. Defaults to 'hackerone' so the existing behavior is
// unchanged for anyone who hasn't opted in to the OpenJS CNA path.
function getCveSource() {
  try {
    const { cve_source } = getMergedConfig();
    return cve_source === 'openjs-cna' ? 'openjs-cna' : 'hackerone';
  } catch {
    return 'hackerone';
  }
}

export function releaseBlogUrlFromDate(releaseDate) {
  if (!releaseDate || releaseDate === 'TBD') return null;
  const d = new Date(releaseDate.replaceAll('/', '-'));
  if (Number.isNaN(d.getTime())) return null;
  const month = d.toLocaleString('en-US', { month: 'long' }).toLowerCase();
  const year = d.getFullYear();
  return `https://nodejs.org/en/blog/vulnerability/${month}-${year}-security-releases`;
}

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
    const cveSource = getCveSource();
    // Always need github + h1 (h1 stays as the bug-bounty source even when CVEs
    // come from OpenJS CNA — sync-back of the CVE id to the H1 report still
    // happens). Add the `cna` token only when the operator opted in.
    const credentials = await auth({
      github: true,
      h1: true,
      cna: cveSource === 'openjs-cna'
    });
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    const { reports } = content;
    this.validateReportsForCVE(reports);
    const req = new Request(credentials);

    if (cveSource === 'openjs-cna') {
      this.cli.info('Requesting CVEs via the OpenJS Foundation CNA');
      await this.promptCVECreationViaOpenJsCna(req, reports, content);
      return;
    }

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

  async promptCVECreation(req, reports, programId, content) {
    const supportedVersions = (await nv('supported'));
    const eolVersions = (await nv('eol'));
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

      const { h1AffectedVersions, patchedVersions } =
        await this.calculateVersions(affectedVersions, supportedVersions, eolVersions);
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
      await confirmSecurityStep(
        this.cli,
        `request CVE for HackerOne report \`${report.id}\``,
        'This submits a CVE request to HackerOne for the selected report.'
      );
      const response = await req.requestCVE(programId, body);
      if (response.errors) {
        this.cli.error(`Error requesting CVE for report ${id}`);
        this.cli.error(JSON.stringify(response.errors, null, 2));
        continue;
      }
      const { cve_identifier } = response.data.attributes;
      report.cveIds = [cve_identifier];
      report.patchedVersions = patchedVersions;
      await this.updateVulnerabilitiesJSON(content);
      await this.updateHackonerReportCve(req, report);
    }
  }

  // Mirror of promptCVECreation that sources the CVE id from the OpenJS
  // Foundation CNA (workflow-backed) instead of HackerOne's cve_requests API.
  // The CVE is then pushed BACK to HackerOne via updateHackonerReportCve so the
  // bug-bounty report stays in sync — H1 is still the source of truth for the
  // report-level state, just not the issuer of the CVE id.
  async promptCVECreationViaOpenJsCna(req, reports, content) {
    const supportedVersions = (await nv('supported'));
    const eolVersions = (await nv('eol'));
    for (const report of reports) {
      const { id, summary, title, affectedVersions, cveIds, link } = report;
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
        } catch {
          this.cli.error(`Couldnt not retrieve severity from report ${id}, skipping...`);
          continue;
        }
      }

      const { cvss_vector_string } = severity;
      const create = await this.cli.prompt(
        `Reserve a CVE via the OpenJS Foundation CNA for: \n
Title: ${title}\n
Link: ${link}\n
Affected versions: ${affectedVersions.join(', ')}\n
Vector: ${cvss_vector_string}\n
Summary: ${summary}\n`,
        { defaultAnswer: true });
      if (!create) continue;

      const { patchedVersions } =
        await this.calculateVersions(affectedVersions, supportedVersions, eolVersions);

      this.cli.startSpinner(`Reserving CVE via OpenJS CNA for report ${id}...`);
      let reserved;
      try {
        // /runs/{correlation_id} returns the operation's structured result on
        // the same response now (see the workflow's CNA_RESULT marker block
        // + the Worker's extractRunResult). Every operation returns
        // `{ cve_id, ... }`-shaped JSON; we just read it off the run object.
        reserved = await req.cnaReserveCve();
      } catch (e) {
        this.cli.stopSpinner(`Failed to reserve CVE for report ${id}: ${e.message}`);
        continue;
      }
      const cveId = reserved.result?.cve_id;
      if (!cveId) {
        this.cli.stopSpinner(
          `Reserve completed but no CVE id in /runs/{id} response for report ${id}; ` +
          `inspect ${reserved.run_url} and retry.`
        );
        continue;
      }
      this.cli.stopSpinner(`Reserved ${cveId} for report ${id} (run ${reserved.run_url}).`);

      report.cveIds = [cveId];
      report.patchedVersions = patchedVersions;
      this.updateVulnerabilitiesJSON(content);

      // Push the CVE id back to HackerOne so the report carries it. This is the
      // exact same call the HackerOne-sourced flow makes — H1 cares that the
      // report has a CVE, not who issued it.
      await this.updateHackonerReportCve(req, report);
    }
  }

  // -----------------------------------------------------------------------
  // git node security --publish-cve
  // -----------------------------------------------------------------------
  // Publish each reserved CVE in vulnerabilities.json by POSTing a v5.2
  // CNA Container to MITRE via the OpenJS Foundation CNA. Reservation and
  // publication are intentionally split: reserve early (so the CVE id can go
  // into the release changelog and blog post), publish late (after the
  // release has shipped on nodejs.org).
  //
  // Only runs when cve_source === 'openjs-cna'. With HackerOne, MITRE is
  // poked automatically via `auto_submit_on_publicly_disclosing_report`, so
  // there's nothing for NCU to do.
  async publishCVEs() {
    const cveSource = getCveSource();
    if (cveSource !== 'openjs-cna') {
      this.cli.warn(
        'cve_source is not "openjs-cna" — nothing to do. ' +
        'HackerOne publishes CVEs automatically via auto_submit_on_publicly_disclosing_report.'
      );
      return;
    }
    const credentials = await auth({ github: true, cna: true });
    const req = new Request(credentials);
    const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
    const content = this.readVulnerabilitiesJSON(vulnerabilitiesJSONPath);
    const reports = (content.reports || []).filter(r => r.cveIds?.length);
    if (!reports.length) {
      this.cli.info('No reports with reserved CVEs to publish.');
      return;
    }
    const releaseBlogUrl = releaseBlogUrlFromDate(content.releaseDate);
    if (!releaseBlogUrl) {
      this.cli.error(
        `vulnerabilities.json has no usable releaseDate (got ${JSON.stringify(content.releaseDate)}). ` +
        'Set the release date before publishing so the MITRE record can point at the per-release blog post.'
      );
      return;
    }
    for (const report of reports) {
      let publishedAny = false;
      for (const cveId of report.cveIds) {
        if (report.publishedAt) {
          this.cli.info(`Skipping ${cveId} (already published).`);
          continue;
        }
        const container = this.buildCnaContainerFromReport(report, cveId, releaseBlogUrl);
        const confirm = await this.cli.prompt(
          `Publish ${cveId} for "${report.title}"?`,
          { defaultAnswer: true }
        );
        if (!confirm) continue;
        this.cli.startSpinner(`Publishing ${cveId} to MITRE…`);
        try {
          await req.cnaPublishCve(cveId, container);
        } catch (e) {
          this.cli.stopSpinner(`Failed to publish ${cveId}: ${e.message}`);
          continue;
        }
        this.cli.stopSpinner(`Published ${cveId}.`);
        publishedAny = true;
      }
      if (publishedAny) {
        report.publishedAt = new Date().toISOString();
        this.updateVulnerabilitiesJSON(content);
      }
    }
  }

  // -----------------------------------------------------------------------
  // vulnerabilities.json → v5.2 CNA Container shape
  // -----------------------------------------------------------------------
  // Minimal viable mapper. Covers Impact / Affected / References / CWE which
  // are the load-bearing fields MITRE requires (providerMetadata.orgId is
  // server-injected by MITRE based on the authed CNA org, so omitted here).
  // Designed to be evolved by replacing this method, not by sprinkling more
  // mapping code into publishCVEs.
  buildCnaContainerFromReport(report, cveId, releaseBlogUrl) {
    const description = report.summary || report.title || '';
    const cweId = report.severity?.weakness_id
      ? `CWE-${report.severity.weakness_id}`
      : null;
    const cvssVector = report.severity?.cvss_vector_string;
    const patchedVersions = report.patchedVersions || [];
    // Pair each affected version with the patched version on the same major
    // release line. Strict equality on the numeric major prevents '18.x' from
    // accidentally matching a patched '1.x' or '180.x' via .startsWith.
    const lessThanFor = (v) => {
      const major = v.split('.')[0];
      return patchedVersions.find(pv => pv.split('.')[0] === major);
    };
    return {
      title: report.title,
      descriptions: [{ lang: 'en', value: description }],
      affected: [{
        vendor: 'nodejs',
        product: 'node',
        defaultStatus: 'unaffected',
        versions: (report.affectedVersions || []).map(v => ({
          version: v,
          status: 'affected',
          lessThan: lessThanFor(v) || undefined
        }))
      }],
      problemTypes: cweId ? [{
        descriptions: [{
          lang: 'en',
          cweId,
          type: 'CWE',
          description: cweId
        }]
      }] : undefined,
      metrics: cvssVector ? [{
        cvssV3_1: { vectorString: cvssVector }
      }] : undefined,
      references: [{ url: releaseBlogUrl, tags: ['vendor-advisory'] }]
    };
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

  async calculateVersions(affectedVersions, supportedVersions, eolVersions) {
    const h1AffectedVersions = [];
    const patchedVersions = [];
    let isPatchRelease = true;
    for (const affectedVersion of affectedVersions) {
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

      patchedVersions.push(patchedVersion);
      h1AffectedVersions.push({
        vendor: 'nodejs',
        product: 'node',
        func: '<=',
        version,
        versionType: 'semver',
        affected: true
      });
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
