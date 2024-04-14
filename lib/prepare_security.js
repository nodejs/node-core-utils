import nv from '@pkgjs/nv';
import fs from 'node:fs';
import path from 'node:path';
import auth from './auth.js';
import Request from './request.js';
import {
  NEXT_SECURITY_RELEASE_BRANCH,
  NEXT_SECURITY_RELEASE_FOLDER,
  NEXT_SECURITY_RELEASE_REPOSITORY,
  PLACEHOLDERS,
  checkoutOnSecurityReleaseBranch,
  commitAndPushVulnerabilitiesJSON,
  getSummary,
  validateDate,
  promptDependencies,
  getSupportedVersions
} from './security-release/security-release.js';
import _ from 'lodash';

export default class SecurityReleaseSteward {
  repository = NEXT_SECURITY_RELEASE_REPOSITORY;
  constructor(cli) {
    this.cli = cli;
  }

  async start() {
    const { cli } = this;
    const credentials = await auth({
      github: true,
      h1: true
    });

    const req = new Request(credentials);
    const release = new PrepareSecurityRelease(req);
    const releaseDate = await release.promptReleaseDate(cli);
    if (releaseDate !== 'TBD') {
      validateDate(releaseDate);
    }

    const createVulnerabilitiesJSON = await release.promptVulnerabilitiesJSON(cli);

    let securityReleasePRUrl;
    if (createVulnerabilitiesJSON) {
      securityReleasePRUrl = await this.startVulnerabilitiesJSONCreation(
        req, release, releaseDate, { cli });
    }

    const createIssue = await release.promptCreateRelaseIssue(cli);

    if (createIssue) {
      const content = await release.buildIssue(releaseDate, securityReleasePRUrl);
      await release.createIssue(content, { cli });
    };

    cli.ok('Done!');
  }

  async startVulnerabilitiesJSONCreation(req, release, releaseDate, { cli }) {
    // checkout on the next-security-release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);

    // choose the reports to include in the security release
    const reports = await release.chooseReports(cli);
    const depUpdates = await release.getDependencyUpdates({ cli });
    const deps = _.groupBy(depUpdates, 'name');

    // create the vulnerabilities.json file in the security-release repo
    const filePath = await release.createVulnerabilitiesJSON(reports, deps, releaseDate, { cli });
    // review the vulnerabilities.json file
    const review = await release.promptReviewVulnerabilitiesJSON(cli);

    if (!review) {
      cli.info(`To push the vulnerabilities.json file run:
        - git add ${filePath}
        - git commit -m "chore: create vulnerabilities.json for next security release"
        - git push -u origin ${NEXT_SECURITY_RELEASE_BRANCH}
        - open a PR on ${release.repository.owner}/${release.repository.repo}`);
      return;
    };

    // commit and push the vulnerabilities.json file
    const commitMessage = 'chore: create vulnerabilities.json for next security release';
    commitAndPushVulnerabilitiesJSON(filePath, commitMessage, { cli, repository: this.repository });

    const createPr = await release.promptCreatePR(cli);

    if (!createPr) return;

    // create pr on the security-release repo
    return release.createPullRequest(req, { cli });
  }
}

class PrepareSecurityRelease {
  repository = NEXT_SECURITY_RELEASE_REPOSITORY;
  title = 'Next Security Release';

  constructor(req, repository) {
    this.req = req;
    if (repository) {
      this.repository = repository;
    }
  }

  promptCreatePR(cli) {
    return cli.prompt(
      'Create the Next Security Release PR?',
      { defaultAnswer: true });
  }

  async getSecurityIssueTemplate() {
    const url = 'https://raw.githubusercontent.com/nodejs/node/main/doc/contributing/security-release-process.md';
    try {
      // fetch document from nodejs/node main so we dont need to keep a copy
      const response = await fetch(url);
      const body = await response.text();
      // remove everything before the Planning section
      const index = body.indexOf('## Planning');
      if (index !== -1) {
        return body.substring(index);
      }
      return body;
    } catch (error) {
      this.cli.error(`Could not retrieve the security issue template from ${url}`);
    }
  }

  async promptReleaseDate(cli) {
    const nextWeekDate = new Date();
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    // Format the date as YYYY/MM/DD
    const formattedDate = nextWeekDate.toISOString().slice(0, 10).replace(/-/g, '/');
    return cli.prompt('Enter target release date in YYYY/MM/DD format (TBD if not defined yet):', {
      questionType: 'input',
      defaultAnswer: formattedDate
    });
  }

  async promptVulnerabilitiesJSON(cli) {
    return cli.prompt(
      'Create the vulnerabilities.json?',
      { defaultAnswer: true });
  }

  async promptCreateRelaseIssue(cli) {
    return cli.prompt(
      'Create the Next Security Release issue?',
      { defaultAnswer: true });
  }

  async promptReviewVulnerabilitiesJSON(cli) {
    return cli.prompt(
      'Please review vulnerabilities.json and press enter to proceed.',
      { defaultAnswer: true });
  }

  async buildIssue(releaseDate, securityReleasePRUrl = PLACEHOLDERS.vulnerabilitiesPRURL) {
    const template = await this.getSecurityIssueTemplate();
    const content = template.replace(PLACEHOLDERS.releaseDate, releaseDate)
      .replace(PLACEHOLDERS.vulnerabilitiesPRURL, securityReleasePRUrl);
    return content;
  }

  async createIssue(content, { cli }) {
    const data = await this.req.createIssue(this.title, content, this.repository);
    if (data.html_url) {
      cli.ok(`Created: ${data.html_url}`);
    } else {
      cli.error(data);
      process.exit(1);
    }
  }

  async chooseReports(cli) {
    cli.info('Getting triaged H1 reports...');
    const reports = await this.req.getTriagedReports();
    const supportedVersions = (await nv('supported'))
      .map((v) => `${v.versionName}.x`)
      .join(',');
    const selectedReports = [];

    for (const report of reports.data) {
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
        continue;
      }

      const versions = await cli.prompt('Which active release lines this report affects?', {
        questionType: 'input',
        defaultAnswer: supportedVersions
      });
      const summaryContent = await getSummary(id, this.req);

      selectedReports.push({
        id,
        title,
        cveIds: cve_ids,
        severity: reportSeverity,
        summary: summaryContent ?? '',
        affectedVersions: versions.split(',').map((v) => v.replace('v', '').trim()),
        link,
        reporter: reporter.data.attributes.username
      });
    }
    return selectedReports;
  }

  async createVulnerabilitiesJSON(reports, dependencies, releaseDate, { cli }) {
    cli.separator('Creating vulnerabilities.json...');
    const file = JSON.stringify({
      releaseDate,
      reports,
      dependencies
    }, null, 2);

    const folderPath = path.join(process.cwd(), NEXT_SECURITY_RELEASE_FOLDER);
    try {
      await fs.accessSync(folderPath);
    } catch (error) {
      await fs.mkdirSync(folderPath, { recursive: true });
    }

    const fullPath = path.join(folderPath, 'vulnerabilities.json');
    fs.writeFileSync(fullPath, file);
    cli.ok(`Created ${fullPath} `);

    return fullPath;
  }

  async createPullRequest(req, { cli }) {
    const { owner, repo } = this.repository;
    const response = await req.createPullRequest(
      this.title,
      'List of vulnerabilities to be included in the next security release',
      {
        owner,
        repo,
        base: 'main',
        head: 'next-security-release'
      }

    );
    const url = response?.html_url;
    if (url) {
      cli.ok(`Created: ${url}`);
      return url;
    }
    if (response?.errors) {
      for (const error of response.errors) {
        cli.error(error.message);
      }
    } else {
      cli.error(response);
    }
    process.exit(1);
  }

  async getDependencyUpdates({ cli }) {
    const deps = [];
    cli.log('\n');
    cli.separator('Dependency Updates');
    const updates = await cli.prompt('Are there dependency updates in this security release?', {
      defaultAnswer: true,
      questionType: 'confirm'
    });

    if (!updates) return deps;

    const supportedVersions = await getSupportedVersions();

    let asking = true;
    while (asking) {
      const dep = await promptDependencies(cli);
      if (!dep) {
        asking = false;
        break;
      }

      const name = await cli.prompt('What is the name of the dependency that has been updated?', {
        defaultAnswer: '',
        questionType: 'input'
      });

      const versions = await cli.prompt('Which release line does this dependency update affect?', {
        defaultAnswer: supportedVersions,
        questionType: 'input'
      });

      try {
        const prUrl = dep.replace('https://github.com/', 'https://api.github.com/repos/').replace('pull', 'pulls');
        const res = await this.req.getPullRequest(prUrl);
        const { html_url, title } = res;
        deps.push({
          name,
          url: html_url,
          title,
          affectedVersions: versions.split(',').map((v) => v.replace('v', '').trim())
        });
        cli.separator();
      } catch (error) {
        this.cli.error('Invalid PR url. Please provide a valid PR url.');
        this.cli.error(error);
      }
    }
    return deps;
  }
}
