import { getReportSeverity, getSummary } from './security-release.js';

// Request.getTriagedReports rejects failed pages rather than returning partial data.
// Selection, metadata edits, and all mutations belong to the caller.
export async function listSecurityReleaseCandidates(request) {
  const { data } = await request.getTriagedReports();
  return data;
}

export function getReportPRURL(report) {
  const customFieldValues = report.relationships.custom_field_values?.data ?? [];
  return customFieldValues[0]?.attributes?.value ?? '';
}

export function buildIncludedTriagedReport(report, options = {}) {
  const {
    affectedVersions = '',
    patchAuthors = [],
    prURL = getReportPRURL(report)
  } = options;
  const {
    id,
    attributes: { title, cve_ids = [] },
    relationships: { reporter }
  } = report;
  const link = `https://hackerone.com/reports/${id}`;
  const summaryContent = getSummary(report);

  return {
    id,
    title,
    cveIds: cve_ids,
    severity: getReportSeverity(report),
    summary: summaryContent ?? '',
    patchAuthors,
    prURL,
    affectedVersions: affectedVersions
      .split(',')
      .map((v) => v.replace('v', '').trim())
      .filter(Boolean),
    link,
    reporter: reporter?.data?.attributes?.username ?? ''
  };
}

export function getMissingReportInformation(report) {
  const missing = [];

  if (!report.severity?.rating) missing.push('severity rating');
  if (!report.severity?.cvss_vector_string) missing.push('CVSS vector');
  if (!report.severity?.weakness_id) missing.push('weakness ID');
  if (!report.summary) missing.push('team summary');
  if (!report.prURL) missing.push('PR URL');
  if (!report.patchAuthors?.length) missing.push('patch authors');
  if (!Object.keys(report.affectedVersions ?? {}).length) missing.push('affected versions');

  return missing;
}

export function groupMissingReportInformation(reports) {
  const grouped = new Map();

  for (const report of reports) {
    for (const field of report.missing) {
      const current = grouped.get(field) ?? [];
      current.push(report);
      grouped.set(field, current);
    }
  }

  return Array.from(grouped.entries())
    .map(([field, fieldReports]) => ({
      field,
      reports: fieldReports
    }))
    .sort((a, b) => b.reports.length - a.reports.length);
}

function normalizeReleaseDate(value) {
  if (value === 'TBD') return value;
  if (typeof value !== 'string' || !/^\d{4}([/-])\d{2}\1\d{2}$/.test(value)) {
    throw new Error('Release date must be YYYY-MM-DD, YYYY/MM/DD, or TBD');
  }
  const date = value.replaceAll('/', '-');
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid release date');
  }
  return date;
}

function normalizeAffectedVersions(value, fallbackPR = '') {
  if (value == null || value === '') return {};
  if (typeof fallbackPR !== 'string') throw new Error('PR URL must be a string');
  let entries;
  if (typeof value === 'string' || Array.isArray(value)) {
    const lines = typeof value === 'string' ? value.split(',') : value;
    entries = lines.map((line) => [line, fallbackPR]);
  } else if (typeof value === 'object') {
    entries = Object.entries(value);
  } else {
    throw new Error('Affected versions must be release lines or a PR map');
  }

  const result = new Map();
  for (const [line, prURL] of entries) {
    if (typeof line !== 'string') throw new Error('Release line must be a string');
    const trimmed = line.trim();
    const match = /^v?(\d+)(?:\.x)?$/.exec(trimmed);
    const normalized = trimmed === 'main' ? 'main' : match && `${match[1]}.x`;
    if (!normalized) throw new Error(`Invalid release line: ${line}`);
    if (typeof prURL !== 'string') throw new Error(`PR URL for ${normalized} must be a string`);
    if (result.has(normalized) && result.get(normalized) !== prURL) {
      throw new Error(`Conflicting PR URLs for ${normalized}`);
    }
    result.set(normalized, prURL);
  }
  return Object.fromEntries(result);
}

// This function only builds data. It does not fetch reports, prompt, write files,
// change branches, commit, push, or create a pull request.
export function prepareSecurityRelease({ releaseDate, reports, dependencies = {} }) {
  const date = normalizeReleaseDate(releaseDate);
  if (!Array.isArray(reports)) throw new Error('Reports must be an array');
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new Error('Dependencies must be an object');
  }

  const ids = new Set();
  const selected = reports.map((report) => {
    if (!report || typeof report.id !== 'string' || !/^\d+$/.test(report.id)) {
      throw new Error('Report ID must be a numeric string');
    }
    if (ids.has(report.id)) throw new Error(`Duplicate report ID: ${report.id}`);
    ids.add(report.id);
    return {
      ...structuredClone(report),
      // A canonical patch is not evidence of a backport for every affected line.
      affectedVersions: normalizeAffectedVersions(report.affectedVersions)
    };
  });

  const deps = Object.fromEntries(Object.entries(dependencies).map(([name, updates]) => {
    const normalizeUpdate = (update) => {
      if (!update || typeof update !== 'object' || Array.isArray(update)) {
        throw new Error(`Invalid dependency update: ${name}`);
      }
      return {
        ...structuredClone(update),
        affectedVersions: normalizeAffectedVersions(update.affectedVersions, update.prURL ?? '')
      };
    };
    const normalized = Array.isArray(updates)
      ? updates.map(normalizeUpdate)
      : normalizeUpdate(updates);
    return [name, normalized];
  }));

  return {
    release: { releaseDate: date, reports: selected, dependencies: deps },
    missingInformation: selected.flatMap((report) => {
      const missing = getMissingReportInformation(report);
      if (!missing.length) return [];
      return [{ id: report.id, title: report.title, link: report.link, missing }];
    })
  };
}
