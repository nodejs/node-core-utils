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
  openSSLUpdate: '%OPENSSL_UPDATES%',
  impact: '%IMPACT%',
  vulnerabilities: '%VULNERABILITIES%'
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

export async function getSummary(reportId, req) {
  const { data } = await req.getReport(reportId);
  const summaryList = data?.relationships?.summaries?.data;
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

export async function pickReport(report, { cli, req }) {
  const {
    id, attributes: { title, cve_ids },
    relationships: { severity, weakness, reporter }
  } = report;
  const link = `https://hackerone.com/reports/${id}`;
  const reportSeverity = {
    rating: severity?.data?.attributes?.rating || '',
    cvss_vector_string: severity?.data?.attributes?.cvss_vector_string || '',
    weakness_id: weakness?.data?.id || ''
  };

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
  const summaryContent = await getSummary(id, req);

  return {
    id,
    title,
    cveIds: cve_ids,
    severity: reportSeverity,
    summary: summaryContent ?? '',
    affectedVersions: versions.split(',').map((v) => v.replace('v', '').trim()),
    link,
    reporter: reporter.data.attributes.username
  };
}
