import nv from '@pkgjs/nv';
import auth from './auth.js';
import Request from './request.js';
import fs from 'node:fs';
import { runSync } from './run.js';
import path from 'node:path';

export const PLACEHOLDERS = {
  releaseDate: '%RELEASE_DATE%',
  vulnerabilitiesPRURL: '%VULNERABILITIES_PR_URL%',
  preReleasePrivate: '%PRE_RELEASE_PRIV%',
  postReleasePrivate: '%POS_RELEASE_PRIV%',
  affectedLines: '%AFFECTED_LINES%'
};

export default class SecurityReleaseSteward {
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
    let securityReleasePRUrl = PLACEHOLDERS.vulnerabilitiesPRURL;

    const createVulnerabilitiesJSON = await release.promptVulnerabilitiesJSON(cli);
    if (createVulnerabilitiesJSON) {
      securityReleasePRUrl = await this.createVulnerabilitiesJSON(req, release, { cli });
    }

    const createIssue = await release.promptCreateRelaseIssue(cli);

    if (createIssue) {
      const { content } = release.buildIssue(releaseDate, securityReleasePRUrl);
      await release.createIssue(content, { cli });
    };

    cli.ok('Done!');
  }

  async createVulnerabilitiesJSON(req, release, { cli }) {
    // checkout on the next-security-release branch
    release.checkoutOnSecurityReleaseBranch(cli);

    // choose the reports to include in the security release
    const reports = await release.chooseReports(cli);

    // create the vulnerabilities.json file in the security-release repo
    const filePath = await release.createVulnerabilitiesJSON(reports, { cli });

    // review the vulnerabilities.json file
    const review = await release.promptReviewVulnerabilitiesJSON(cli);

    if (!review) {
      cli.info(`To push the vulnerabilities.json file run:
        - git add ${filePath}
        - git commit -m "chore: create vulnerabilities.json for next security release"
        - git push -u origin next-security-release
        - open a PR on ${release.repository.owner}/${release.repository.repo}`);
      return;
    };

    // commit and push the vulnerabilities.json file
    release.commitAndPushVulnerabilitiesJSON(filePath, cli);

    const createPr = await release.promptCreatePR(cli);

    if (!createPr) return;

    // create pr on the security-release repo
    return release.createPullRequest(req, { cli });
  }
}

class PrepareSecurityRelease {
  repository = {
    owner: 'nodejs-private',
    repo: 'security-release'
  };

  title = 'Next Security Release';
  nextSecurityReleaseBranch = 'next-security-release';

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

  checkRemote(cli) {
    const remote = runSync('git', ['ls-remote', '--get-url', 'origin']).trim();
    const { owner, repo } = this.repository;
    const securityReleaseOrigin = `https://github.com/${owner}/${repo}.git`;

    if (remote !== securityReleaseOrigin) {
      cli.error(`Wrong repository! It should be ${securityReleaseOrigin}`);
      process.exit(1);
    }
  }

  commitAndPushVulnerabilitiesJSON(filePath, cli) {
    this.checkRemote(cli);

    runSync('git', ['add', filePath]);
    const commitMessage = 'chore: create vulnerabilities.json for next security release';
    runSync('git', ['commit', '-m', commitMessage]);
    runSync('git', ['push', '-u', 'origin', 'next-security-release']);
    cli.ok(`Pushed commit: ${commitMessage} to ${this.nextSecurityReleaseBranch}`);
  }

  getSecurityIssueTemplate() {
    return fs.readFileSync(
      new URL(
        './github/templates/next-security-release.md',
        import.meta.url
      ),
      'utf-8'
    );
  }

  async promptReleaseDate(cli) {
    return cli.prompt('Enter target release date in YYYY-MM-DD format:', {
      questionType: 'input',
      defaultAnswer: 'TBD'
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

  buildIssue(releaseDate, securityReleasePRUrl) {
    const template = this.getSecurityIssueTemplate();
    const content = template.replace(PLACEHOLDERS.releaseDate, releaseDate)
      .replace(PLACEHOLDERS.vulnerabilitiesPRURL, securityReleasePRUrl);
    return { releaseDate, content, securityReleasePRUrl };
  }

  async createIssue(content, { cli }) {
    const data = await this.req.createIssue(this.title, content, this.repository);
    if (data.html_url) {
      cli.ok('Created: ' + data.html_url);
    } else {
      cli.error(data);
      process.exit(1);
    }
  }

  async chooseReports(cli) {
    cli.info('Getting triaged H1 reports...');
    const reports = await this.req.getTriagedReports();
    const supportedVersions = (await nv('supported'))
      .map((v) => v.versionName + '.x')
      .join(',');
    const selectedReports = [];

    for (const report of reports.data) {
      const { id, attributes: { title, cve_ids }, relationships: { severity } } = report;
      const link = `https://hackerone.com/reports/${id}`;
      const reportLevel = severity ? severity.data.attributes.rating : 'TBD';
      cli.separator();
      cli.info(`Report: ${link} - ${title} (${reportLevel})`);
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
      const summaryContent = await this.getSummary(id);

      selectedReports.push({
        id,
        title,
        cve_ids,
        severity: reportLevel,
        summary: summaryContent ?? '',
        affectedVersions: versions.split(',').map((v) => v.replace('v', '').trim()),
        link
      });
    }
    return selectedReports;
  }

  async getSummary(reportId) {
    const { data } = await this.req.getReport(reportId);
    const summaryList = data?.relationships?.summaries?.data;
    if (!summaryList?.length) return;
    const summaries = summaryList.filter((summary) => summary?.attributes?.category === 'team');
    if (!summaries?.length) return;
    return summaries?.[0].attributes?.content;
  }

  checkoutOnSecurityReleaseBranch(cli) {
    this.checkRemote(cli);
    const currentBranch = runSync('git', ['branch', '--show-current']).trim();
    cli.info(`Current branch: ${currentBranch} `);

    if (currentBranch !== this.nextSecurityReleaseBranch) {
      runSync('git', ['checkout', '-B', this.nextSecurityReleaseBranch]);
      cli.ok(`Checkout on branch: ${this.nextSecurityReleaseBranch} `);
    };
  }

  async createVulnerabilitiesJSON(reports, { cli }) {
    cli.separator('Creating vulnerabilities.json...');
    const file = JSON.stringify({
      reports
    }, null, 2);

    const folderPath = path.join(process.cwd(), 'security-release', 'next-security-release');
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
      cli.ok('Created: ' + url);
      return url;
    } else {
      if (response?.errors) {
        for (const error of response.errors) {
          cli.error(error.message);
        }
      } else {
        cli.error(response);
      }
      process.exit(1);
    }
  }
}
