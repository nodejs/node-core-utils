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
  getSummary,
  pickReport,
  confirmSecurityStep,
  writeSecurityFile,
  SecurityRelease
} from './security-release/security-release.js';

function relativeDate(date) {
  const days = Math.floor((Date.now() - date) / (1000 * 60 * 60 * 24));
  if (days < 30) return days === 1 ? '1 day ago' : `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function formatDaysFromNow(days) {
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}

function getNextTuesdayReleaseDateObjects(fromDate = new Date(), count = 4) {
  const TUESDAY = 2;
  const start = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate()
  );
  const daysUntilTuesday = (TUESDAY - start.getDay() + 7) % 7 || 7;
  start.setDate(start.getDate() + daysUntilTuesday);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + (index * 7));
    return {
      date,
      daysFromNow: daysUntilTuesday + (index * 7)
    };
  });
}

export function getNextTuesdayReleaseDates(fromDate = new Date(), count = 4) {
  return getNextTuesdayReleaseDateObjects(fromDate, count)
    .map(({ date }) => formatDate(date));
}

export function getNextTuesdayReleaseDateChoices(fromDate = new Date(), count = 4) {
  const choices = getNextTuesdayReleaseDateObjects(fromDate, count)
    .map(({ date, daysFromNow }) => {
      const formattedDate = formatDate(date);
      return {
        name: formattedDate,
        value: formattedDate,
        description: `Tuesday, ${formatDaysFromNow(daysFromNow)}`
      };
    });

  choices.push({
    name: 'TBD',
    value: 'TBD',
    description: 'Release date not defined yet'
  });

  return choices;
}

function getReportPRURL(report) {
  const customFieldValues = report.relationships.custom_field_values?.data ?? [];
  return customFieldValues[0]?.attributes?.value ?? '';
}

export function buildIncludedTriagedReport(report, options = {}) {
  const {
    affectedVersions = '',
    patchAuthors = [],
    prURL = getReportPRURL(report)
  } = options;
  const {
    id,
    attributes: { title, cve_ids = [] },
    relationships: { reporter }
  } = report;
  const link = `https://hackerone.com/reports/${id}`;
  const summaryContent = getSummary(report);

  return {
    id,
    title,
    cveIds: cve_ids,
    severity: getReportSeverity(report),
    summary: summaryContent ?? '',
    patchAuthors,
    prURL,
    affectedVersions: affectedVersions
      .split(',')
      .map((v) => v.replace('v', '').trim())
      .filter(Boolean),
    link,
    reporter: reporter?.data?.attributes?.username ?? ''
  };
}

export function getMissingReportInformation(report) {
  const missing = [];

  if (!report.severity?.rating) missing.push('severity rating');
  if (!report.severity?.cvss_vector_string) missing.push('CVSS vector');
  if (!report.severity?.weakness_id) missing.push('weakness ID');
  if (!report.summary) missing.push('team summary');
  if (!report.prURL) missing.push('PR URL');
  if (!report.patchAuthors?.length) missing.push('patch authors');
  if (!report.affectedVersions?.length) missing.push('affected versions');

  return missing;
}

export function groupMissingReportInformation(reports) {
  const grouped = new Map();

  for (const report of reports) {
    for (const field of report.missing) {
      const current = grouped.get(field) ?? [];
      current.push(report);
      grouped.set(field, current);
    }
  }

  return Array.from(grouped.entries())
    .map(([field, fieldReports]) => ({
      field,
      reports: fieldReports
    }))
    .sort((a, b) => b.reports.length - a.reports.length);
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
    const releaseDate = await this.promptReleaseDate();
    if (releaseDate !== 'TBD') {
      validateDate(releaseDate);
    }
    const createVulnerabilitiesJSON = await this.promptVulnerabilitiesJSON();

    const content = await this.buildDescription(releaseDate);
    if (createVulnerabilitiesJSON) {
      const reportSelectionMode = await this.promptReportSelectionMode();
      if (reportSelectionMode === 'review') {
        const showTriaged = await this.promptShowTriagedWithoutPR();
        if (showTriaged) {
          excludedReports = await this.showTriagedReportsWithoutPR();
        }
      }
      await this.startVulnerabilitiesJSONCreation(
        releaseDate, content, excludedReports, reportSelectionMode);
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

  async startVulnerabilitiesJSONCreation(
    releaseDate,
    content,
    excludedReports = [],
    reportSelectionMode = 'review'
  ) {
    // checkout on the next-security-release branch
    await checkoutOnSecurityReleaseBranch(this.cli, this.repository);

    // choose the reports to include in the security release
    const reports = reportSelectionMode === 'include-all'
      ? await this.includeAllTriagedReports(excludedReports)
      : await this.chooseReports(excludedReports);
    const deps = await this.getDependencyUpdates();

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
    const choices = getNextTuesdayReleaseDateChoices();
    return this.cli.promptSelect(
      'Select target release date:',
      choices,
      { defaultAnswer: choices[0].value }
    );
  }

  async promptVulnerabilitiesJSON() {
    return this.cli.prompt(
      'Create the vulnerabilities.json?',
      { defaultAnswer: true });
  }

  async promptReportSelectionMode() {
    return this.cli.promptSelect(
      'How would you like to choose reports for the next security release?',
      [
        {
          name: 'Review each triaged report',
          value: 'review',
          description: 'Iterate over reports and fill missing details interactively'
        },
        {
          name: 'Include all triaged reports',
          value: 'include-all',
          description: 'Add every triaged report and summarize missing information'
        }
      ],
      { defaultAnswer: 'review' }
    );
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

  async includeAllTriagedReports(excludedReports = []) {
    this.cli.info('Getting triaged H1 reports...');
    const reports = await this.req.getTriagedReports();
    const supportedVersions = await getSupportedVersions();
    const selectedReports = [];
    const missingInformation = [];

    for (const report of reports.data) {
      if (excludedReports.includes(report.id)) continue;

      const reportData = await this.buildIncludedTriagedReport(
        report,
        supportedVersions
      );
      selectedReports.push(reportData);

      const missing = getMissingReportInformation(reportData);
      if (missing.length) {
        missingInformation.push({
          id: reportData.id,
          title: reportData.title,
          link: reportData.link,
          missing
        });
      }
    }

    this.displayMissingReportInformationSummary(missingInformation);
    return selectedReports;
  }

  async buildIncludedTriagedReport(report, supportedVersions) {
    const prURL = getReportPRURL(report);
    const patchAuthors = await this.getPatchAuthorsFromPR(prURL);
    return buildIncludedTriagedReport(report, {
      affectedVersions: supportedVersions,
      patchAuthors,
      prURL
    });
  }

  async getPatchAuthorsFromPR(prURL) {
    if (!prURL) return [];

    try {
      const { user } = await this.req.getPullRequest(prURL);
      return user?.login ? [user.login] : [];
    } catch (error) {
      this.cli.warn(`Could not fetch patch author from ${prURL}`);
      this.cli.error(error);
      return [];
    }
  }

  displayMissingReportInformationSummary(reports) {
    if (!reports.length) {
      this.cli.ok('All included reports have the expected information.');
      return;
    }

    const grouped = groupMissingReportInformation(reports);
    this.cli.warn(
      `${reports.length} included reports are missing information:`
    );
    for (const { field, reports: fieldReports } of grouped) {
      const reportList = fieldReports
        .map(({ id }) => `H1 #${id}`)
        .join(', ');
      this.cli.info(
        `- ${field} (${fieldReports.length}): ${reportList}`
      );
    }
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

  // Collect dependency updates using the same schema as the reports: each
  // dependency maps every affected release line to the PR that lands it, e.g.
  //   { undici: { affectedVersions: { '22.x': '<prURL>', '24.x': '<prURL>' } } }
  async getDependencyUpdates() {
    const deps = {};
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
        'Which release line(s) does this dependency update PR affect? ' +
        '(comma-separated)', {
          defaultAnswer: supportedVersions,
          questionType: 'input'
        });

      try {
        const res = await this.req.getPullRequest(dep);
        const { html_url: prURL } = res;
        const affectedVersions = versions
          .split(',')
          .map((v) => v.replace('v', '').trim())
          .filter(Boolean);

        deps[name] ??= { affectedVersions: {} };
        for (const line of affectedVersions) {
          deps[name].affectedVersions[line] = prURL;
        }
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
