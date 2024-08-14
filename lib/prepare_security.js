import fs from 'node:fs';
import path from 'node:path';
import auth from './auth.js';
import Request from './request.js';
import {
  NEXT_SECURITY_RELEASE_BRANCH,
  NEXT_SECURITY_RELEASE_FOLDER,
  checkoutOnSecurityReleaseBranch,
  commitAndPushVulnerabilitiesJSON,
  validateDate,
  promptDependencies,
  getSupportedVersions,
  pickReport,
  SecurityRelease
} from './security-release/security-release.js';
import _ from 'lodash';

export default class PrepareSecurityRelease extends SecurityRelease {
  title = 'Next Security Release';

  async start() {
    const credentials = await auth({
      github: true,
      h1: true
    });

    this.req = new Request(credentials);
    const releaseDate = await this.promptReleaseDate();
    if (releaseDate !== 'TBD') {
      validateDate(releaseDate);
    }
    const createVulnerabilitiesJSON = await this.promptVulnerabilitiesJSON();

    let securityReleasePRUrl;
    const content = await this.buildDescription(releaseDate, securityReleasePRUrl);
    if (createVulnerabilitiesJSON) {
      securityReleasePRUrl = await this.startVulnerabilitiesJSONCreation(releaseDate, content);
    }

    this.cli.ok('Done!');
  }

  async cleanup() {
    const credentials = await auth({
      github: true,
      h1: true
    });

    this.req = new Request(credentials);
    const vulnerabilityJSON = this.readVulnerabilitiesJSON();
    this.cli.info('Closing and request disclosure to HackerOne reports');
    await this.closeAndRequestDisclosure(vulnerabilityJSON.reports);

    this.cli.info('Closing pull requests');
    // For now, close the ones with vN.x label
    await this.closePRWithLabel(this.getAffectedVersions(vulnerabilityJSON));

    const updateFolder = this.cli.prompt(
      // eslint-disable-next-line max-len
      `Would you like to update the next-security-release folder to ${vulnerabilityJSON.releaseDate}?`,
      { defaultAnswer: true });
    if (updateFolder) {
      const newFolder = this.updateReleaseFolder(vulnerabilityJSON.releaseDate);
      commitAndPushVulnerabilitiesJSON(
        newFolder,
        'chore: change next-security-release folder',
        { cli: this.cli, repository: this.repository }
      );
    }
    this.cli.info(`Merge pull request with:
        - git checkout main
        - git merge --squash ${NEXT_SECURITY_RELEASE_BRANCH}
        - git push origin main`);
    this.cli.ok('Done!');
  }

  async startVulnerabilitiesJSONCreation(releaseDate, content) {
    // checkout on the next-security-release branch
    checkoutOnSecurityReleaseBranch(this.cli, this.repository);

    // choose the reports to include in the security release
    const reports = await this.chooseReports();
    const depUpdates = await this.getDependencyUpdates();
    const deps = _.groupBy(depUpdates, 'name');

    // create the vulnerabilities.json file in the security-release repo
    const filePath = await this.createVulnerabilitiesJSON(reports, deps, releaseDate);

    // review the vulnerabilities.json file
    const review = await this.promptReviewVulnerabilitiesJSON();

    if (!review) {
      this.cli.info(`To push the vulnerabilities.json file run:
        - git add ${filePath}
        - git commit -m "chore: create vulnerabilities.json for next security release"
        - git push -u origin ${NEXT_SECURITY_RELEASE_BRANCH}
        - open a PR on ${this.repository.owner}/${this.repository.repo}`);
      return;
    };

    // commit and push the vulnerabilities.json file
    const commitMessage = 'chore: create vulnerabilities.json for next security release';
    commitAndPushVulnerabilitiesJSON(filePath,
      commitMessage,
      { cli: this.cli, repository: this.repository });

    const createPr = await this.promptCreatePR();

    if (!createPr) return;

    // create pr on the security-release repo
    return this.createPullRequest(content);
  }

  promptCreatePR() {
    return this.cli.prompt(
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

  async promptReleaseDate() {
    const nextWeekDate = new Date();
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    // Format the date as YYYY/MM/DD
    const formattedDate = nextWeekDate.toISOString().slice(0, 10).replace(/-/g, '/');
    return this.cli.prompt(
      'Enter target release date in YYYY/MM/DD format (TBD if not defined yet):', {
        questionType: 'input',
        defaultAnswer: formattedDate
      });
  }

  async promptVulnerabilitiesJSON() {
    return this.cli.prompt(
      'Create the vulnerabilities.json?',
      { defaultAnswer: true });
  }

  async promptCreateRelaseIssue() {
    return this.cli.prompt(
      'Create the Next Security Release issue?',
      { defaultAnswer: true });
  }

  async promptReviewVulnerabilitiesJSON() {
    return this.cli.prompt(
      'Please review vulnerabilities.json and press enter to proceed.',
      { defaultAnswer: true });
  }

  async buildDescription() {
    const template = await this.getSecurityIssueTemplate();
    return template;
  }

  async chooseReports() {
    this.cli.info('Getting triaged H1 reports...');
    const reports = await this.req.getTriagedReports();
    const selectedReports = [];

    for (const report of reports.data) {
      const rep = await pickReport(report, { cli: this.cli, req: this.req });
      if (!rep) continue;
      selectedReports.push(rep);
    }
    return selectedReports;
  }

  async createVulnerabilitiesJSON(reports, dependencies, releaseDate) {
    this.cli.separator('Creating vulnerabilities.json...');
    const file = JSON.stringify({
      releaseDate,
      reports,
      dependencies
    }, null, 2);

    const folderPath = path.join(process.cwd(), NEXT_SECURITY_RELEASE_FOLDER);
    try {
      fs.accessSync(folderPath);
    } catch (error) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const fullPath = path.join(folderPath, 'vulnerabilities.json');
    fs.writeFileSync(fullPath, file);
    this.cli.ok(`Created ${fullPath} `);

    return fullPath;
  }

  async createPullRequest(content) {
    const { owner, repo } = this.repository;
    const response = await this.req.createPullRequest(
      this.title,
      content ?? 'List of vulnerabilities to be included in the next security release',
      {
        owner,
        repo,
        base: 'main',
        head: 'next-security-release'
      }

    );
    const url = response?.html_url;
    if (url) {
      this.cli.ok(`Created: ${url}`);
      return url;
    }
    if (response?.errors) {
      for (const error of response.errors) {
        this.cli.error(error.message);
      }
    } else {
      this.cli.error(response);
    }
    process.exit(1);
  }

  async getDependencyUpdates() {
    const deps = [];
    this.cli.log('\n');
    this.cli.separator('Dependency Updates');
    const updates = await this.cli.prompt('Are there dependency updates in this security release?',
      {
        defaultAnswer: true,
        questionType: 'confirm'
      });

    if (!updates) return deps;

    const supportedVersions = await getSupportedVersions();

    let asking = true;
    while (asking) {
      const dep = await promptDependencies(this.cli);
      if (!dep) {
        asking = false;
        break;
      }

      const name = await this.cli.prompt(
        'What is the name of the dependency that has been updated?', {
          defaultAnswer: '',
          questionType: 'input'
        });

      const versions = await this.cli.prompt(
        'Which release line does this dependency update affect?', {
          defaultAnswer: supportedVersions,
          questionType: 'input'
        });

      try {
        const res = await this.req.getPullRequest(dep);
        const { html_url, title } = res;
        deps.push({
          name,
          url: html_url,
          title,
          affectedVersions: versions.split(',').map((v) => v.replace('v', '').trim())
        });
        this.cli.separator();
      } catch (error) {
        this.cli.error('Invalid PR url. Please provide a valid PR url.');
        this.cli.error(error);
      }
    }
    return deps;
  }

  async closeAndRequestDisclosure(jsonReports) {
    this.cli.startSpinner('Closing HackerOne reports');
    for (const report of jsonReports) {
      this.cli.updateSpinner(`Closing report ${report.id}...`);
      await this.req.updateReportState(
        report.id,
        'resolved',
        'Closing as resolved'
      );

      this.cli.updateSpinner(`Requesting disclosure to report ${report.id}...`);
      await this.req.requestDisclosure(report.id);
    }
    this.cli.stopSpinner('Done closing H1 Reports and requesting disclosure');
  }

  async closePRWithLabel(labels) {
    if (typeof labels === 'string') {
      labels = [labels];
    }

    const url = 'https://github.com/nodejs-private/node-private/pulls';
    this.cli.startSpinner('Closing GitHub Pull Requests...');
    // At this point, GitHub does not provide filters through their REST API
    const prs = this.req.getPullRequest(url);
    for (const pr of prs) {
      if (pr.labels.some((l) => labels.includes(l))) {
        this.cli.updateSpinner(`Closing Pull Request: ${pr.id}`);
        await this.req.closePullRequest(pr.id);
      }
    }
    this.cli.startSpinner('Closed GitHub Pull Requests.');
  }
}
