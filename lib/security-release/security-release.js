import { runSync } from '../run.js';
import nv from '@pkgjs/nv';
import fs from 'node:fs';
import path from 'node:path';

export const NEXT_SECURITY_RELEASE_BRANCH = 'next-security-release';
export const NEXT_SECURITY_RELEASE_FOLDER = 'security-release/next-security-release';

export const NEXT_SECURITY_RELEASE_REPOSITORY = {
  owner: 'nodejs-private',
  repo: 'security-release'
};

export const PLACEHOLDERS = {
  releaseDate: '%RELEASE_DATE%',
  vulnerabilitiesPRURL: '%VULNERABILITIES_PR_URL%',
  preReleasePrivate: '%PRE_RELEASE_PRIV%',
  postReleasePrivate: '%POS_RELEASE_PRIV%',
  affectedLines: '%AFFECTED_LINES%',
  annoucementDate: '%ANNOUNCEMENT_DATE%',
  slug: '%SLUG%',
  affectedVersions: '%AFFECTED_VERSIONS%',
  impact: '%IMPACT%',
  vulnerabilities: '%VULNERABILITIES%',
  reports: '%REPORTS%',
  author: '%AUTHOR%',
  dependencyUpdates: '%DEPENDENCY_UPDATES%',
  downloads: '%DOWNLOADS%'
};

export function checkRemote(cli, repository) {
  const remote = runSync('git', ['ls-remote', '--get-url', 'origin']).trim();
  const { owner, repo } = repository;
  const securityReleaseOrigin = [
    `https://github.com/${owner}/${repo}.git`,
    `git@github.com:${owner}/${repo}.git`
  ];

  if (!securityReleaseOrigin.includes(remote)) {
    cli.error(`Wrong repository! It should be ${securityReleaseOrigin}`);
    process.exit(1);
  }
}

export function checkoutOnSecurityReleaseBranch(cli, repository) {
  checkRemote(cli, repository);
  const currentBranch = runSync('git', ['branch', '--show-current']).trim();
  cli.info(`Current branch: ${currentBranch} `);

  if (currentBranch !== NEXT_SECURITY_RELEASE_BRANCH) {
    runSync('git', ['checkout', '-B', NEXT_SECURITY_RELEASE_BRANCH]);
    cli.ok(`Checkout on branch: ${NEXT_SECURITY_RELEASE_BRANCH} `);
  };
}

export function commitAndPushVulnerabilitiesJSON(filePath, commitMessage, { cli, repository }) {
  checkRemote(cli, repository);

  if (Array.isArray(filePath)) {
    for (const path of filePath) {
      runSync('git', ['add', path]);
    }
  } else {
    runSync('git', ['add', filePath]);
  }

  const staged = runSync('git', ['diff', '--name-only', '--cached']).trim();
  if (!staged) {
    cli.ok('No changes to commit');
    return;
  }

  runSync('git', ['commit', '-m', commitMessage]);

  try {
    runSync('git', ['push', '-u', 'origin', NEXT_SECURITY_RELEASE_BRANCH]);
  } catch (error) {
    cli.warn('Rebasing...');
    // try to pull rebase and push again
    runSync('git', ['pull', 'origin', NEXT_SECURITY_RELEASE_BRANCH, '--rebase']);
    runSync('git', ['push', '-u', 'origin', NEXT_SECURITY_RELEASE_BRANCH]);
  }
  cli.ok(`Pushed commit: ${commitMessage} to ${NEXT_SECURITY_RELEASE_BRANCH}`);
}

export async function getSupportedVersions() {
  const supportedVersions = (await nv('supported'))
    .map((v) => `${v.versionName}.x`)
    .join(',');
  return supportedVersions;
}

export function getSummary(report) {
  const summaryList = report?.relationships?.summaries?.data;
  if (!summaryList?.length) return;
  const summaries = summaryList.filter((summary) => summary?.attributes?.category === 'team');
  if (!summaries?.length) return;
  return summaries?.[0].attributes?.content;
}

export function getVulnerabilitiesJSON(cli) {
  const vulnerabilitiesJSONPath = path.join(process.cwd(),
    NEXT_SECURITY_RELEASE_FOLDER, 'vulnerabilities.json');
  cli.startSpinner(`Reading vulnerabilities.json from ${vulnerabilitiesJSONPath}..`);
  const file = JSON.parse(fs.readFileSync(vulnerabilitiesJSONPath, 'utf-8'));
  cli.stopSpinner(`Done reading vulnerabilities.json from ${vulnerabilitiesJSONPath}`);
  return file;
}

export function validateDate(releaseDate) {
  const value = new Date(releaseDate).valueOf();
  if (Number.isNaN(value) || value < 0) {
    throw new Error('Invalid date format');
  }
}

export function formatDateToYYYYMMDD(date) {
  // Get year, month, and day
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const day = String(date.getDate()).padStart(2, '0');

  // Concatenate year, month, and day with slashes
  return `${year}/${month}/${day}`;
}

export function promptDependencies(cli) {
  return cli.prompt('Enter the link to the dependency update PR (leave empty to exit): ', {
    defaultAnswer: '',
    questionType: 'input'
  });
}

export async function createIssue(title, content, repository, { cli, req }) {
  const data = await req.createIssue(title, content, repository);
  if (data.html_url) {
    cli.ok(`Created: ${data.html_url}`);
  } else {
    cli.error(data);
    process.exit(1);
  }
}

export function getReportSeverity(report) {
  const {
    relationships: { severity, weakness }
  } = report;
  const reportSeverity = {
    rating: severity?.data?.attributes?.rating || '',
    cvss_vector_string: severity?.data?.attributes?.cvss_vector_string || '',
    weakness_id: weakness?.data?.id || ''
  };
  return reportSeverity;
}

export async function pickReport(report, { cli, req }) {
  const {
    id, attributes: { title, cve_ids },
    relationships: { reporter, custom_field_values }
  } = report;
  const link = `https://hackerone.com/reports/${id}`;
  const reportSeverity = getReportSeverity(report);

  cli.separator();
  cli.info(`Report: ${link} - ${title} (${reportSeverity?.rating})`);
  const include = await cli.prompt(
    'Would you like to include this report to the next security release?',
    { defaultAnswer: true });
  if (!include) {
    return;
  }

  const versions = await cli.prompt('Which active release lines this report affects?', {
    questionType: 'input',
    defaultAnswer: await getSupportedVersions()
  });

  let prURL = '';
  let patchAuthors = [];
  if (custom_field_values.data.length) {
    prURL = custom_field_values.data[0].attributes.value;
    const { user } = await req.getPullRequest(prURL);
    patchAuthors = [user.login];
  } else {
    patchAuthors = await cli.prompt(
      'Add github username of the authors of the patch (split by comma if multiple)', {
        questionType: 'input',
        defaultAnswer: ''
      });

    if (!patchAuthors) {
      patchAuthors = [];
    } else {
      patchAuthors = patchAuthors.split(',').map((p) => p.trim());
    }
  }

  const summaryContent = getSummary(report);

  return {
    id,
    title,
    cveIds: cve_ids,
    severity: reportSeverity,
    summary: summaryContent ?? '',
    patchAuthors,
    prURL,
    affectedVersions: versions.split(',').map((v) => v.replace('v', '').trim()),
    link,
    reporter: reporter.data.attributes.username
  };
}

export class SecurityRelease {
  constructor(cli, repository = NEXT_SECURITY_RELEASE_REPOSITORY) {
    this.cli = cli;
    this.repository = repository;
  }

  readVulnerabilitiesJSON(vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath()) {
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

  updateReleaseFolder(releaseDate) {
    const folder = path.join(process.cwd(),
      NEXT_SECURITY_RELEASE_FOLDER);
    const newFolder = path.join(process.cwd(), releaseDate);
    fs.renameSync(folder, newFolder);
    return newFolder;
  }

  updateVulnerabilitiesJSON(content) {
    try {
      const vulnerabilitiesJSONPath = this.getVulnerabilitiesJSONPath();
      this.cli.startSpinner(`Updating vulnerabilities.json from ${vulnerabilitiesJSONPath}...`);
      fs.writeFileSync(vulnerabilitiesJSONPath, JSON.stringify(content, null, 2));
      commitAndPushVulnerabilitiesJSON(vulnerabilitiesJSONPath,
        'chore: updated vulnerabilities.json',
        { cli: this.cli, repository: this.repository });
      this.cli.stopSpinner(`Done updating vulnerabilities.json from ${vulnerabilitiesJSONPath}`);
    } catch (error) {
      this.cli.error('Error updating vulnerabilities.json');
      this.cli.error(error);
    }
  }

  getAffectedVersions(content) {
    const affectedVersions = new Set();
    for (const report of Object.values(content.reports)) {
      for (const affectedVersion of report.affectedVersions) {
        affectedVersions.add(affectedVersion);
      }
    }
    const parseToNumber = str => +(str.match(/[\d.]+/g)[0]);
    return Array.from(affectedVersions)
      .sort((a, b) => {
        return parseToNumber(a) > parseToNumber(b) ? -1 : 1;
      })
      .join(', ');
  }
}
