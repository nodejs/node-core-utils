import { runSync } from '../run.js';

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
  affectedLines: '%AFFECTED_LINES%'
};

export function checkRemote(cli, repository) {
  const remote = runSync('git', ['ls-remote', '--get-url', 'origin']).trim();
  const { owner, repo } = repository;
  const securityReleaseOrigin = `https://github.com/${owner}/${repo}.git`;

  if (remote !== securityReleaseOrigin) {
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
