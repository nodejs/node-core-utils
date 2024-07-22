import CLI from '../../lib/cli.js';
import PrepareSecurityRelease from '../../lib/prepare_security.js';
import UpdateSecurityRelease from '../../lib/update_security_release.js';
import SecurityBlog from '../../lib/security_blog.js';
import SecurityAnnouncement from '../../lib/security-announcement.js';

export const command = 'security [options]';
export const describe = 'Manage an in-progress security release or start a new one.';

const securityOptions = {
  start: {
    describe: 'Start security release process',
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
    describe: 'Create the pre-release announcement',
    type: 'boolean'
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
    describe: 'Create the post-release announcement',
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
      'git node security --pre-release',
      'Create the pre-release announcement on the Nodejs.org repo'
    ).example(
      'git node security --notify-pre-release',
      'Notifies the community about the security release'
    ).example(
      'git node security --request-cve',
      'Request CVEs for a security release of Node.js based on' +
      ' the next-security-release/vulnerabilities.json'
    ).example(
      'git node security --post-release',
      'Create the post-release announcement on the Nodejs.org repo'
    );
}

export function handler(argv) {
  if (argv.start) {
    return startSecurityRelease(argv);
  }
  if (argv.sync) {
    return syncSecurityRelease(argv);
  }
  if (argv['update-date']) {
    return updateReleaseDate(argv);
  }
  if (argv['pre-release']) {
    return createPreRelease(argv);
  }
  if (argv['add-report']) {
    return addReport(argv);
  }
  if (argv['remove-report']) {
    return removeReport(argv);
  }
  if (argv['notify-pre-release']) {
    return notifyPreRelease(argv);
  }
  if (argv['request-cve']) {
    return requestCVEs(argv);
  }
  if (argv['post-release']) {
    return createPostRelease(argv);
  }
  yargsInstance.showHelp();
}

async function removeReport(argv) {
  const reportId = argv['remove-report'];
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const update = new UpdateSecurityRelease(cli);
  return update.removeReport(reportId);
}

async function addReport(argv) {
  const reportId = argv['add-report'];
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const update = new UpdateSecurityRelease(cli);
  return update.addReport(reportId);
}

async function updateReleaseDate(argv) {
  const releaseDate = argv['update-date'];
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const update = new UpdateSecurityRelease(cli);
  return update.updateReleaseDate(releaseDate);
}

async function createPreRelease() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const preRelease = new SecurityBlog(cli);
  return preRelease.createPreRelease();
}

async function requestCVEs() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const hackerOneCve = new UpdateSecurityRelease(cli);
  return hackerOneCve.requestCVEs();
}

async function createPostRelease() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const blog = new SecurityBlog(cli);
  return blog.createPostRelease();
}

async function startSecurityRelease() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const release = new PrepareSecurityRelease(cli);
  return release.start();
}

async function syncSecurityRelease(argv) {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const release = new UpdateSecurityRelease(cli);
  return release.sync();
}

async function notifyPreRelease() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const preRelease = new SecurityAnnouncement(cli);
  return preRelease.notifyPreRelease();
}
