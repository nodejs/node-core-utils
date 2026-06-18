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
  getReportSeverity,
  pickReport,
  confirmSecurityStep,
  writeSecurityFile,
  SecurityRelease
} from './security-release/security-release.js';
import _ from 'lodash';

function relativeDate(date) {
  const days = Math.floor((Date.now() - date) / (1000 * 60 * 60 * 24));
  if (days < 30) return days === 1 ? '1 day ago' : `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export default class PrepareSecurityRelease extends SecurityRelease {
  title = 'Next Security Release';

  async start() {
    const credentials = await auth({
      github: true,
      h1: true
    });

    this.req = new Request(credentials);

    let excludedReports = [];
    const showTriaged = await this.promptShowTriagedWithoutPR();
    if (showTriaged) {
      excludedReports = await this.showTriagedReportsWithoutPR();
    }

    const releaseDate = await this.promptReleaseDate();
    if (releaseDate !== 'TBD') {
      validateDate(releaseDate);
    }
    const createVulnerabilitiesJSON = await this.promptVulnerabilitiesJSON();

    const content = await this.buildDescription(releaseDate);
    if (createVulnerabilitiesJSON) {
      await this.startVulnerabilitiesJSONCreation(
        releaseDate, content, excludedReports);
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
    // For now, close the ones with Security Release label
    await this.closePRWithLabel('Security Release');

    if (vulnerabilityJSON.buildIssue) {
      this.cli.info('Commenting on nodejs/build issue');
      await confirmSecurityStep(
        this.cli,
        `comment on GitHub issue \`${vulnerabilityJSON.buildIssue}\``,
        'This posts that the security release is out on the build tracking issue.'
      );
      await this.req.commentIssue(
        vulnerabilityJSON.buildIssue,
        'Security release is out'
      );
    }

    if (vulnerabilityJSON.dockerIssue) {
      this.cli.info('Commenting on nodejs/docker-node issue');
      await confirmSecurityStep(
        this.cli,
        `comment on GitHub issue \`${vulnerabilityJSON.dockerIssue}\``,
        'This posts that the security release is out on the docker-node tracking issue.'
      );
      await this.req.commentIssue(
        vulnerabilityJSON.dockerIssue,
        'Security release is out'
      );
    }

    const updateFolder = await this.cli.prompt(
      `Would you like to update the next-security-release folder to ${
        vulnerabilityJSON.releaseDate}?`,
      { defaultAnswer: true });
    if (updateFolder) {
      await this.updateReleaseFolder(
        vulnerabilityJSON.releaseDate.replaceAll('/', '-')
      );
      const securityReleaseFolder = path.join(process.cwd(), 'security-release');
      await commitAndPushVulnerabilitiesJSON(
        securityReleaseFolder,
        'chore: change next-security-release folder',
        { cli: this.cli, repository: this.repository }
      );
    }
    this.cli.info(`If the PR is ready (CI is passing): merge pull request with:
        - git checkout main
        - git merge ${NEXT_SECURITY_RELEASE_BRANCH} --no-ff -m "chore: add latest security release"
        - git push origin main`);
    this.cli.ok('Done!');
  }

  async startVulnerabilitiesJSONCreation(releaseDate, content, excludedReports = []) {
    // checkout on the next-security-release branch
    await checkoutOnSecurityReleaseBranch(this.cli, this.repository);

    // choose the reports to include in the security release
    const reports = await this.chooseReports(excludedReports);
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
    await commitAndPushVulnerabilitiesJSON(filePath,
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

  async promptShowTriagedWithoutPR() {
    return this.cli.prompt(
      'Do you want to see which reports are triaged but have no PR URL?',
      { defaultAnswer: true });
  }

  async showTriagedReportsWithoutPR() {
    this.cli.info('Fetching triaged reports without PR URL...');
    const reports = await this.req.getTriagedReports();
    const reportsWithoutPR = reports.data.filter(
      (report) => !report.relationships.custom_field_values.data.length
    );
    if (!reportsWithoutPR.length) {
      this.cli.ok('All triaged reports have a PR URL.');
      return [];
    }
    const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
    const choices = reportsWithoutPR
      .sort((a, b) => {
        const dateA = new Date(a.attributes.created_at);
        const dateB = new Date(b.attributes.created_at);
        if (dateB - dateA !== 0) return dateB - dateA;
        const rankA = severityRank[getReportSeverity(a).rating] ?? 4;
        const rankB = severityRank[getReportSeverity(b).rating] ?? 4;
        return rankA - rankB;
      })
      .map((report) => {
        const { id, attributes: { title, created_at } } = report;
        const { rating } = getReportSeverity(report);
        const openedDate = relativeDate(new Date(created_at));
        const link = `https://hackerone.com/reports/${id}`;
        return {
          name: `[${openedDate}] (${rating}) ${title} - ${link}`,
          value: id,
          checked: true
        };
      });
    return this.cli.promptCheckbox(
      'Select reports to exclude from the upcoming security release:',
      choices
    );
  }

  async buildDescription() {
    const template = await this.getSecurityIssueTemplate();
    return template;
  }

  async chooseReports(excludedReports = []) {
    this.cli.info('Getting triaged H1 reports...');
    const reports = await this.req.getTriagedReports();
    const selectedReports = [];

    for (const report of reports.data) {
      if (excludedReports.includes(report.id)) continue;
      const rep = await pickReport(report, { cli: this.cli, req: this.req });
      if (!rep) continue;
      selectedReports.push(rep);
    }
    return selectedReports;
  }

  async createVulnerabilitiesJSON(reports, dependencies, releaseDate) {
    this.cli.startSpinner('Creating vulnerabilities.json...');
    const fileContent = JSON.stringify({
      releaseDate,
      reports,
      dependencies
    }, null, 2) + '\n';

    const folderPath = path.resolve(NEXT_SECURITY_RELEASE_FOLDER);
    const fullPath = path.join(folderPath, 'vulnerabilities.json');
    await confirmSecurityStep(
      this.cli,
      `create directory \`${folderPath}\``,
      'This creates the security release folder if it does not already exist.'
    );
    await fs.promises.mkdir(folderPath, { recursive: true });
    await writeSecurityFile(
      this.cli,
      fullPath,
      fileContent,
      'This creates vulnerabilities.json for the next security release.'
    );
    this.cli.stopSpinner(`Created ${fullPath}`);

    return fullPath;
  }

  async createPullRequest(content) {
    const { owner, repo } = this.repository;
    await confirmSecurityStep(
      this.cli,
      `create GitHub pull request \`${owner}/${repo}: ${this.title}\``,
      `This opens a pull request from ${NEXT_SECURITY_RELEASE_BRANCH} to main.`
    );
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

    while (true) {
      const dep = await promptDependencies(this.cli);
      if (!dep) {
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
      await confirmSecurityStep(
        this.cli,
        `resolve HackerOne report \`${report.id}\``,
        'This marks the HackerOne report as resolved.'
      );
      await this.req.updateReportState(
        report.id,
        'resolved',
        'Closing as resolved'
      );

      this.cli.updateSpinner(`Requesting disclosure to report ${report.id}...`);
      await confirmSecurityStep(
        this.cli,
        `request disclosure for HackerOne report \`${report.id}\``,
        'This asks HackerOne to disclose the resolved report.'
      );
      await this.req.requestDisclosure(report.id);
    }
    this.cli.stopSpinner('Done closing H1 Reports and requesting disclosure');
  }

  async closePRWithLabel(labels) {
    if (typeof labels === 'string') {
      labels = [labels];
    }

    const url = 'https://github.com/nodejs-private/node-private/pull';
    this.cli.startSpinner('Closing GitHub Pull Requests...');
    // At this point, GitHub does not provide filters through their REST API
    const prs = await this.req.getPullRequest(url);
    for (const pr of prs) {
      if (pr.labels.some((l) => labels.includes(l.name))) {
        this.cli.updateSpinner(`Closing Pull Request: ${pr.number}`);
        await confirmSecurityStep(
          this.cli,
          `close GitHub pull request \`nodejs-private/node-private#${pr.number}\``,
          'This closes a pull request labeled for the security release.'
        );
        await this.req.closePullRequest(pr.number,
          { owner: 'nodejs-private', repo: 'node-private' });
      }
    }
    this.cli.stopSpinner('Closed GitHub Pull Requests.');
  }
}
