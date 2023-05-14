import nv from '@pkgjs/nv';
import auth from './auth.js';
import Request from './request.js';
import fs from 'node:fs';

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
    const create = await cli.prompt(
      'Create the Next Security Release issue?',
      { defaultAnswer: true });
    if (create) {
      const issue = new SecurityReleaseIssue(req);
      const content = await issue.buildIssue(cli);
      const data = await req.createIssue('Next Security Release', content, {
        owner: 'nodejs-private',
        repo: 'node-private'
      });
      if (data.html_url) {
        cli.ok('Created: ' + data.html_url);
      } else {
        cli.error(data);
      }
    }
  }
}

class SecurityReleaseIssue {
  constructor(req) {
    this.req = req;
    this.content = '';
    this.title = 'Next Security Release';
    this.affectedLines = {};
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

  async buildIssue(cli) {
    this.content = this.getSecurityIssueTemplate();
    cli.info('Getting triaged H1 reports...');
    const reports = await this.req.getTriagedReports();
    await this.fillReports(cli, reports);

    this.fillAffectedLines(Object.keys(this.affectedLines));

    const target = await cli.prompt('Enter target date in YYYY-MM-DD format:', {
      questionType: 'input',
      defaultAnswer: 'TBD'
    });
    this.fillTargetDate(target);

    return this.content;
  }

  async fillReports(cli, reports) {
    const supportedVersions = (await nv('supported'))
      .map((v) => v.versionName + '.x')
      .join(',');

    let reportsContent = '';
    for (const report of reports.data) {
      const { id, attributes: { title }, relationships: { severity } } = report;
      const reportLevel = severity.data.attributes.rating;
      cli.separator();
      cli.info(`Report: ${id} - ${title} (${reportLevel})`);
      const include = await cli.prompt(
        'Would you like to include this report to the next security release?',
        { defaultAnswer: true });
      if (!include) {
        continue;
      }

      reportsContent +=
        `  * **[${id}](https://hackerone.com/bugs?subject=nodejs&report_id=${id}) - ${title} (TBD) - (${reportLevel})**\n`;
      const versions = await cli.prompt('Which active release lines this report affects?', {
        questionType: 'input',
        defaultAnswer: supportedVersions
      });
      for (const v of versions.split(',')) {
        if (!this.affectedLines[v]) this.affectedLines[v] = true;
        reportsContent += `    * ${v} - TBD\n`;
      }
    }
    this.content = this.content.replace('%REPORTS%', reportsContent);
  }

  fillAffectedLines(affectedLines) {
    let affected = '';
    for (const line of affectedLines) {
      affected += `  * ${line} - TBD\n`;
    }
    this.content =
      this.content.replace('%AFFECTED_LINES%', affected);
  }

  fillTargetDate(date) {
    this.content = this.content.replace('%RELEASE_DATE%', date);
  }
}
