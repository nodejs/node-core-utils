import CLI from '../../lib/cli.js';
import PrepareSecurityRelease from '../../lib/prepare_security.js';
import UpdateSecurityRelease from '../../lib/update_security_release.js';
import SecurityBlog from '../../lib/security_blog.js';
import SecurityAnnouncement from '../../lib/security-announcement.js';
import ValidateReports from '../../lib/validate_reports.js';

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
  'validate-reports': {
    describe: 'Validate triaged HackerOne reports against the Node.js threat model',
    type: 'boolean'
  },
  'validate-reports-format': {
    choices: ['markdown', 'json'],
    default: 'markdown',
    describe: 'Output format for --validate-reports',
    type: 'string'
  },
  'validate-reports-output': {
    describe: 'Write --validate-reports output to a file instead of stdout',
    type: 'string'
  },
  'validate-reports-limit': {
    describe: 'Maximum number of triaged reports to validate',
    type: 'number'
  },
  'validate-reports-confirm': {
    default: true,
    describe: 'Ask before each LLM prompt or assessment, and before continuing to the next report',
    type: 'boolean'
  },
  'validate-reports-cache': {
    default: true,
    describe: 'Reuse cached LLM assessments for the same report, model, and prompt',
    type: 'boolean'
  },
  llm: {
    choices: ['none', 'codex', 'claude', 'copilot'],
    describe: 'Print prompts for manual LLM use or ask an LLM CLI to assess each triaged report',
    type: 'string'
  },
  'llm-model': {
    describe: 'Override the LLM model used for command construction and cache identity',
    type: 'string'
  },
  'llm-command': {
    describe: 'Override the command used for --llm. The report prompt is sent on stdin.',
    type: 'string'
  },
  'llm-allow-paid-usage': {
    describe: 'Allow LLM providers that may incur token-based charges without prompting',
    type: 'boolean'
  },
  'node-repo': {
    default: process.cwd(),
    describe: 'Node.js checkout path the LLM should use to read SECURITY.md and doc/',
    type: 'string'
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
      'git node security --validate-reports',
      'Validate triaged HackerOne reports against the Node.js threat model'
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
  if (argv['validate-reports']) {
    return validateReports(cli, argv);
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

async function validateReports(cli, argv) {
  const validator = new ValidateReports(cli, argv);
  return validator.validate();
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
