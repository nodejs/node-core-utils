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

  runSync('git', ['commit', '-m', commitMessage]);
  runSync('git', ['push', '-u', 'origin', NEXT_SECURITY_RELEASE_BRANCH]);
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
