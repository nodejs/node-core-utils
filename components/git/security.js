import CLI from '../../lib/cli.js';
import SecurityReleaseSteward from '../../lib/prepare_security.js';
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
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs.options(securityOptions)
    .example(
      'git node security --start',
      'Prepare a security release of Node.js')
    .example(
      'git node security --update-date=YYYY/MM/DD',
      'Updates the target date of the security release'
    )
    .example(
      'git node security --add-report=H1-ID',
      'Fetches HackerOne report based on ID provided and adds it into vulnerabilities.json'
    )
    .example(
      'git node security --remove-report=H1-ID',
      'Removes the Hackerone report based on ID provided from vulnerabilities.json'
    )
    .example(
      'git node security --pre-release' +
      'Create the pre-release announcement on the Nodejs.org repo'
    ).example(
      'git node security --notify-pre-release' +
      'Notifies the community about the security release'
    );
}

export function handler(argv) {
  if (argv.start) {
    return startSecurityRelease(argv);
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

async function startSecurityRelease() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const release = new SecurityReleaseSteward(cli);
  return release.start();
}

async function notifyPreRelease() {
  const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
  const cli = new CLI(logStream);
  const preRelease = new SecurityAnnouncement(cli);
  return preRelease.notifyPreRelease();
}
