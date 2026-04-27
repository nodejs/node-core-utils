import auth from '../../lib/auth.js';
import Request from '../../lib/request.js';
import LandingSession from '../../lib/landing_session.js';
import Session from '../../lib/session.js';
import CLI from '../../lib/cli.js';
import { getMetadata } from '../metadata.js';
import { checkCwd } from '../../lib/update-v8/common.js';
import PrepareSecurityRelease from '../../lib/prepare_security.js';
import UpdateSecurityRelease from '../../lib/update_security_release.js';
import SecurityBlog from '../../lib/security_blog.js';
import SecurityAnnouncement from '../../lib/security-announcement.js';
import { forceRunAsync } from '../../lib/run.js';

export const command = 'security [options]';
export const describe = 'Manage an in-progress security release or start a new one.';

const SECURITY_REPO = {
  owner: 'nodejs-private',
  repo: 'node-private',
};

const securityOptions = {
  start: {
    describe: 'Start security release process',
    type: 'boolean'
  },
  'apply-patches': {
    describe: 'Start an interactive session to make local HEAD ready to create ' +
      'a security release proposal',
    type: 'boolean'
  },
  sync: {
    describe: 'Synchronize an ongoing security release with HackerOne',
    type: 'boolean'
  },
  'update-date': {
    describe: 'Updates the target date of the security release',
    type: 'string'
  },
  'add-report': {
    describe: 'Extracts data from HackerOne report and adds it into vulnerabilities.json',
    type: 'string'
  },
  'remove-report': {
    describe: 'Removes a report from vulnerabilities.json',
    type: 'string'
  },
  'pre-release': {
    describe: 'Create the pre-release announcement to the given nodejs.org folder',
    type: 'string'
  },
  'notify-pre-release': {
    describe: 'Notify the community about the security release',
    type: 'boolean'
  },
  'request-cve': {
    describe: 'Request CVEs for a security release',
    type: 'boolean'
  },
  'post-release': {
    describe: 'Create the post-release announcement to the given nodejs.org folder',
    type: 'string'
  },
  cleanup: {
    describe: 'cleanup the security release.',
    type: 'boolean'
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs.options(securityOptions)
    .example(
      'git node security --start',
      'Prepare a security release of Node.js'
    )
    .example(
      'git node security --prepare-local-branch',
      'Fetch all the patches for an upcoming security release'
    )
    .example(
      'git node security --sync',
      'Synchronize an ongoing security release with HackerOne'
    )
    .example(
      'git node security --update-date=YYYY/MM/DD',
      'Updates the target date of the security release'
    ).example(
      'git node security --add-report=H1-ID',
      'Fetches HackerOne report based on ID provided and adds it into vulnerabilities.json'
    ).example(
      'git node security --remove-report=H1-ID',
      'Removes the Hackerone report based on ID provided from vulnerabilities.json'
    ).example(
      'git node security --pre-release="../nodejs.org/"',
      'Create the pre-release announcement on the Nodejs.org repo'
    ).example(
      'git node security --notify-pre-release',
      'Notifies the community about the security release'
    ).example(
      'git node security --request-cve',
      'Request CVEs for a security release of Node.js based on' +
      ' the next-security-release/vulnerabilities.json'
    ).example(
      'git node security --post-release="../nodejs.org/"',
      'Create the post-release announcement on the Nodejs.org repo'
    ).example(
      'git node security --cleanup',
      'Cleanup the security release. Merge the PR and close H1 reports'
    );
}

export function handler(argv) {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);

  if (argv.start) {
    return startSecurityRelease(cli, argv);
  }
  if (argv['apply-patches']) {
    return applySecurityPatches(cli, argv);
  }
  if (argv.sync) {
    return syncSecurityRelease(cli, argv);
  }
  if (argv['update-date']) {
    return updateReleaseDate(cli, argv);
  }
  if (argv['pre-release']) {
    return createPreRelease(cli, argv);
  }
  if (argv['add-report']) {
    return addReport(cli, argv);
  }
  if (argv['remove-report']) {
    return removeReport(cli, argv);
  }
  if (argv['notify-pre-release']) {
    return notifyPreRelease(cli, argv);
  }
  if (argv['request-cve']) {
    return requestCVEs(cli, argv);
  }
  if (argv['post-release']) {
    return createPostRelease(cli, argv);
  }
  if (argv.cleanup) {
    return cleanupSecurityRelease(cli, argv);
  }
  yargsInstance.showHelp();
}

async function removeReport(cli, argv) {
  const reportId = argv['remove-report'];
  const update = new UpdateSecurityRelease(cli);
  return update.removeReport(reportId);
}

async function addReport(cli, argv) {
  const reportId = argv['add-report'];
  const update = new UpdateSecurityRelease(cli);
  return update.addReport(reportId);
}

async function updateReleaseDate(cli, argv) {
  const releaseDate = argv['update-date'];
  const update = new UpdateSecurityRelease(cli);
  return update.updateReleaseDate(releaseDate);
}

async function createPreRelease(cli, argv) {
  const nodejsOrgFolder = argv['pre-release'];
  const preRelease = new SecurityBlog(cli);
  return preRelease.createPreRelease(nodejsOrgFolder);
}

async function requestCVEs(cli) {
  const hackerOneCve = new UpdateSecurityRelease(cli);
  return hackerOneCve.requestCVEs();
}

async function createPostRelease(cli, argv) {
  const nodejsOrgFolder = argv['post-release'];
  const blog = new SecurityBlog(cli);
  return blog.createPostRelease(nodejsOrgFolder);
}

async function startSecurityRelease(cli) {
  const release = new PrepareSecurityRelease(cli);
  return release.start();
}

async function fetchVulnerabilitiesDotJSON(cli, req) {
  const { owner } = SECURITY_REPO;
  const repo = 'security-release';

  cli.startSpinner(`Looking for Security Release PR on ${owner}/${repo}`);
  const { repository: { pullRequests: { nodes: { length, 0: pr } } } } =
    await req.gql('ListSecurityReleasePRs', { owner, repo });
  if (length !== 1) {
    cli.stopSpinner('Expected exactly one open Pull Request on the ' +
      `${owner}/${repo} repository, found ${length}`,
    cli.SPINNER_STATUS.FAILED);
    cli.setExitCode(1);
    return;
  }
  if (pr.files.nodes.length !== 1 || !pr.files.nodes[0].path.endsWith('vulnerabilities.json')) {
    cli.stopSpinner(
      `${owner}/${repo}#${pr.number} does not contain only vulnerabilities.json`,
      cli.SPINNER_STATUS.FAILED
    );
    cli.setExitCode(1);
    return;
  }
  cli.stopSpinner(`Found ${owner}/${repo}#${pr.number} by @${pr.author.login}`);
  cli.startSpinner('Fetching vulnerabilities.json...');
  const result = await req.json(
    `/repos/${owner}/${repo}/contents/${pr.files.nodes[0].path}?ref=${pr.headRefOid}`,
    { headers: { Accept: 'application/vnd.github.raw+json' } }
  );
  cli.stopSpinner('Fetched vulnerabilities.json');
  return result;
}
async function applySecurityPatches(cli) {
  const { nodeMajorVersion } = await checkCwd({ nodeDir: process.cwd() });
  const credentials = await auth({
    github: true
  });
  const req = new Request(credentials);

  cli.info('N.B.: if there are commits on the staging branch that need to be included in the ' +
    'security release, please rebase them manually and answer no to the following question');
  // Try reset to the public upstream
  await new Session(cli, process.cwd()).tryResetBranch();

  const { owner, repo } = SECURITY_REPO;
  const { releaseDate, reports } = await fetchVulnerabilitiesDotJSON(cli, req);
  cli.startSpinner(`Fetching open PRs on ${owner}/${repo}...`);
  const { repository: { pullRequests: { nodes } } } = await req.gql('PRs', {
    owner, repo, labels: [`v${nodeMajorVersion}.x`],
  });
  cli.stopSpinner(`Fetched all PRs labeled for v${nodeMajorVersion}.x`);
  let patchedVersion;
  let hasDetachedHEAD = false;
  for (const { affectedVersions, prURL, cveIds, patchedVersions } of reports) {
    if (!affectedVersions.includes(`${nodeMajorVersion}.x`)) continue;
    patchedVersion ??= patchedVersions?.find(v => v.startsWith(`${nodeMajorVersion}.`));
    cli.separator(`Taking care of ${cveIds.join(', ')}...`);

    const existingCommit = await forceRunAsync('git',
      ['--no-pager', 'log', 'HEAD', '--grep', `^PR-URL: ${prURL}$`, '--format=%h %s'],
      { ignoreFailure: false, captureStdout: true });
    if (existingCommit.trim()) {
      cli.info(`${prURL} seems to already be on the current tree: ${existingCommit}`);
      const response = await cli.prompt('Do you want to skip it?', { defaultAnswer: true });
      if (response) continue;
    }

    let pr = nodes.find(({ url }) => url === prURL);
    if (!pr) {
      cli.info(
        `${prURL} is not labelled for v${nodeMajorVersion}.x, there might be a backport PR.`
      );

      cli.startSpinner('Fetching PR title to find a match...');
      const { title } = await req.getPullRequest(prURL);
      pr = nodes.find((pr) => pr.title.endsWith(title));
      if (pr) {
        cli.stopSpinner(`Found ${pr.url}`);
      } else {
        cli.stopSpinner(`Did not find a match for "${title}"`, cli.SPINNER_STATUS.WARN);
        const prID = await cli.prompt(
          'Please enter the PR number to use:',
          { questionType: cli.QUESTION_TYPE.NUMBER, defaultAnswer: NaN }
        );
        pr = nodes.find(({ number }) => number === prID);
        if (!pr) {
          cli.error(`${prID} is not in the list of PRs labelled for v${nodeMajorVersion}.x`);
          cli.info('The list of labelled PRs and vulnerabilities.json are fetched ' +
            'once at the start of the session; to refresh those, start a new NCU session');
          const response = await cli.prompt('Do you want to skip that CVE?',
            { defaultAnswer: false });
          if (response) continue;
          throw new Error(`Found no patch for ${cveIds}`);
        }
      }
    }
    cli.ok(`${pr.url} is labelled for v${nodeMajorVersion}.x.`);
    const response = await cli.prompt('Do you want to land it on the current HEAD?',
      { defaultAnswer: true });
    if (!response) {
      cli.info('Skipping');
      cli.warn('The resulting HEAD will not be ready for a release proposal');
      continue;
    }
    const backport = prURL !== pr.url;

    if (!hasDetachedHEAD) {
      // Moving to a detached HEAD, we don't want the security patches to be pushed to the public repo
      await forceRunAsync('git', ['checkout', '--detach'], { ignoreFailure: false });
      hasDetachedHEAD = true;
    }

    const session = new LandingSession(cli, req, process.cwd(), {
      prid: pr.number, backport, autorebase: true, oneCommitMax: false,
      ...SECURITY_REPO
    });
    Object.defineProperty(session, 'tryResetBranch', {
      __proto__: null,
      value: Function.prototype,
      configurable: true,
    });
    const metadata = await getMetadata(session.argv, true, cli);
    if (backport) {
      metadata.metadata += `PR-URL: ${prURL}\n`;
    }
    metadata.metadata += cveIds.map(cve => `CVE-ID: ${cve}\n`).join('');
    await session.start(metadata);
  }
  cli.ok('All patches are on the local HEAD!');
  cli.info('You can now build and test, and create a proposal with the following commands:');
  cli.info(`git switch -C v${nodeMajorVersion}.x HEAD`);
  cli.info(`git node release --prepare --security --newVersion=${patchedVersion} ` +
    `--releaseDate=${releaseDate.replaceAll('/', '-')} --skipBranchDiff`);
}

async function cleanupSecurityRelease(cli) {
  const release = new PrepareSecurityRelease(cli);
  return release.cleanup();
}

async function syncSecurityRelease(cli) {
  const release = new UpdateSecurityRelease(cli);
  return release.sync();
}

async function notifyPreRelease(cli) {
  const preRelease = new SecurityAnnouncement(cli);
  return preRelease.notifyPreRelease();
}
