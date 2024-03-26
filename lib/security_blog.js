import fs from 'node:fs';
import path from 'node:path';
import _ from 'lodash';
import {
  PLACEHOLDERS,
  getVulnerabilitiesJSON,
  checkoutOnSecurityReleaseBranch,
  NEXT_SECURITY_RELEASE_REPOSITORY,
  validateDate
} from './security-release/security-release.js';

export default class SecurityBlog {
  repository = NEXT_SECURITY_RELEASE_REPOSITORY;
  constructor(cli) {
    this.cli = cli;
  }

  async createPreRelease() {
    const { cli } = this;

    // checkout on security release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);

    // read vulnerabilities JSON file
    const content = getVulnerabilitiesJSON(cli);
    // validate the release date read from vulnerabilities JSON
    if (!content.releaseDate) {
      cli.error('Release date is not set in vulnerabilities.json,' +
        ' run `git node security --update-date=YYYY/MM/DD` to set the release date.');
      process.exit(1);
    }

    validateDate(content.releaseDate);
    const releaseDate = new Date(content.releaseDate);

    const template = this.getSecurityPreReleaseTemplate();
    const data = {
      annoucementDate: await this.getAnnouncementDate(cli),
      releaseDate: this.formatReleaseDate(releaseDate),
      affectedVersions: this.getAffectedVersions(content),
      vulnerabilities: this.getVulnerabilities(content),
      slug: this.getSlug(releaseDate),
      impact: this.getImpact(content),
      openSSLUpdate: await this.promptOpenSSLUpdate(cli)
    };
    const month = releaseDate.toLocaleString('en-US', { month: 'long' }).toLowerCase();
    const year = releaseDate.getFullYear();
    const fileName = `${month}-${year}-security-releases.md`;
    const preRelease = this.buildPreRelease(template, data);
    const file = path.join(process.cwd(), fileName);
    fs.writeFileSync(file, preRelease);
    cli.ok(`Pre-release announcement file created at ${file}`);
  }

  async createPostRelease() {
    const { cli } = this;

    // checkout on security release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);

    // read vulnerabilities JSON file
    const content = getVulnerabilitiesJSON(cli);
    if (!content.releaseDate) {
      cli.error('Release date is not set in vulnerabilities.json,' +
        ' run `git node security --update-date=YYYY/MM/DD` to set the release date.');
      process.exit(1);
    }

    validateDate(content.releaseDate);
    const releaseDate = new Date(content.releaseDate);
    const template = this.getSecurityPostReleaseTemplate();
    const data = {
      annoucementDate: await this.getAnnouncementDate(cli),
      releaseDate: this.formatReleaseDate(releaseDate),
      affectedVersions: this.getAffectedVersions(content),
      vulnerabilities: this.getVulnerabilities(content),
      slug: this.getSlug(releaseDate),
      openSSLUpdate: await this.promptOpenSSLUpdate(cli),
      author: await this.promptAuthor(cli),
      reports: content.reports,
      dependencyUpdates: await this.promptDependencyUpdates(cli)
    };
    const postReleaseContent = await this.buildPostRelease(template, data);

    const pathPreRelease = await this.promptExistingPreRelease(cli);
    // read the existing pre-release announcement
    let preReleaseContent = fs.readFileSync(pathPreRelease, 'utf-8');
    // cut the part before summary
    const preSummary = preReleaseContent.indexOf('# Summary');
    if (preSummary !== -1) {
      preReleaseContent = preReleaseContent.substring(preSummary);
    }

    const updatedContent = postReleaseContent + preReleaseContent;

    fs.writeFileSync(pathPreRelease, updatedContent);
    cli.ok(`Post-release announcement file updated at ${pathPreRelease}`);
  }

  async promptExistingPreRelease(cli) {
    const pathPreRelease = await cli.prompt(
      'Please provide the path of the existing pre-release announcement:', {
        questionType: 'input',
        defaultAnswer: ''
      });

    if (!pathPreRelease || !fs.existsSync(path.resolve(pathPreRelease))) {
      return this.promptExistingPreRelease(cli);
    }
    return pathPreRelease;
  }

  promptDependencyUpdates(cli) {
    return cli.prompt('Does this security release contain dependency updates?', {
      defaultAnswer: true
    });
  }

  promptOpenSSLUpdate(cli) {
    return cli.prompt('Does this security release containt OpenSSL updates?', {
      defaultAnswer: true
    });
  }

  promptAuthor(cli) {
    return cli.prompt('Who is the author of this security release? If multiple' +
      ' use & as separator', {
      questionType: 'input',
      defaultAnswer: PLACEHOLDERS.author
    });
  }

  formatReleaseDate(releaseDate) {
    const options = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    };
    return releaseDate.toLocaleDateString('en-US', options);
  }

  buildPreRelease(template, data) {
    const {
      annoucementDate,
      releaseDate,
      affectedVersions,
      vulnerabilities,
      slug,
      impact,
      openSSLUpdate
    } = data;
    return template.replaceAll(PLACEHOLDERS.annoucementDate, annoucementDate)
      .replaceAll(PLACEHOLDERS.slug, slug)
      .replaceAll(PLACEHOLDERS.affectedVersions, affectedVersions)
      .replaceAll(PLACEHOLDERS.vulnerabilities, vulnerabilities)
      .replaceAll(PLACEHOLDERS.releaseDate, releaseDate)
      .replaceAll(PLACEHOLDERS.impact, impact)
      .replaceAll(PLACEHOLDERS.openSSLUpdate, this.getOpenSSLUpdateTemplate(openSSLUpdate));
  }

  async buildPostRelease(template, data) {
    const {
      annoucementDate,
      releaseDate,
      affectedVersions,
      vulnerabilities,
      slug,
      impact,
      openSSLUpdate,
      author,
      reports,
      dependencyUpdates
    } = data;
    return template.replaceAll(PLACEHOLDERS.annoucementDate, annoucementDate)
      .replaceAll(PLACEHOLDERS.slug, slug)
      .replaceAll(PLACEHOLDERS.affectedVersions, affectedVersions)
      .replaceAll(PLACEHOLDERS.vulnerabilities, vulnerabilities)
      .replaceAll(PLACEHOLDERS.releaseDate, releaseDate)
      .replaceAll(PLACEHOLDERS.impact, impact)
      .replaceAll(PLACEHOLDERS.openSSLUpdate, this.getOpenSSLUpdateTemplate(openSSLUpdate))
      .replaceAll(PLACEHOLDERS.author, author)
      .replaceAll(PLACEHOLDERS.reports, await this.getReportsTemplate(reports))
      .replaceAll(PLACEHOLDERS.dependencyUpdates,
        await this.getDependencyUpdatesTemplate(dependencyUpdates));
  }

  async getReportsTemplate(reports) {
    let template = '';
    for (const report of reports) {
      let cveId = report.cve_ids.join(', ');
      if (!cveId) {
        // TODO(@marco-ippolito): fetch the CVE ID from hackerone
        cveId = await this.cli.prompt(`What is the CVE ID for vulnerability https://hackerone.com/reports/${report.id} ${report.title}?`, {
          questionType: 'input',
          defaultAnswer: 'TBD'
        });
        // TODO(@marco-ippolito): save the cve_id in the vulnerabilities JSON
        report.cve_ids = [cveId];
      }
      template += `\n## ${report.title} (${cveId}) - (${report.severity.rating})\n\n`;
      if (!report.summary) {
        // TODO(@marco-ippolito): fetch the summary
        // from hackerone and update the vulnerabilities JSON
        this.cli.warn(`Summary is missing for vulnerability:\
 ${report.link}. Please add it manually.`);
      }
      template += `${report.summary}\n\n`;
      const releaseLines = report.affectedVersions.join(', ');
      template += `Impact:\n\n- This vulnerability affects all users\
 in active release lines: ${releaseLines}\n\n`;
      let contributor = report.contributor;
      if (!contributor) {
        contributor = await this.cli.prompt(`Who fixed vulnerability https://hackerone.com/reports/${report.id} ${report.title}? If multiple use & as separator`, {
          questionType: 'input',
          defaultAnswer: 'TBD'
        });
      }
      template += `Thank you, to ${report.reporter} for reporting this vulnerability\
and thank you ${contributor} for fixing it.\n`;
    }
    return template;
  }

  async getDependencyUpdatesTemplate(dependencyUpdates) {
    if (!dependencyUpdates) return '';
    const template = 'This security release includes the following dependency' +
      ' updates to address public vulnerabilities:\n';
    return template;
  }

  getOpenSSLUpdateTemplate(openSSLUpdate) {
    if (!openSSLUpdate) return '';
    return '\n## OpenSSL Security updates\n\n' +
      'This security release includes OpenSSL security updates\n';
  }

  getSlug(releaseDate) {
    const month = releaseDate.toLocaleString('en-US', { month: 'long' });
    const year = releaseDate.getFullYear();
    return `${month.toLocaleLowerCase()}-${year}-security-releases`;
  }

  async getAnnouncementDate(cli) {
    try {
      const date = await this.promptAnnouncementDate(cli);
      validateDate(date);
      return new Date(date).toISOString();
    } catch (error) {
      return PLACEHOLDERS.annoucementDate;
    }
  }

  promptAnnouncementDate(cli) {
    const today = new Date().toISOString().substring(0, 10).replace(/-/g, '/');
    return cli.prompt('When is the security release going to be announced? ' +
      'Enter in YYYY/MM/DD format:', {
      questionType: 'input',
      defaultAnswer: today
    });
  }

  getImpact(content) {
    const impact = content.reports.reduce((acc, report) => {
      for (const affectedVersion of report.affectedVersions) {
        if (acc[affectedVersion]) {
          acc[affectedVersion].push(report);
        } else {
          acc[affectedVersion] = [report];
        }
      }
      return acc;
    }, {});

    const impactText = [];
    for (const [key, value] of Object.entries(impact)) {
      const groupedByRating = Object.values(_.groupBy(value, 'severity.rating'))
        .map(severity => {
          if (!severity[0]?.severity?.rating) {
            this.cli.error(`severity.rating not found for the report ${severity[0].id}. \
              Please add it manually before continuing.`);
            process.exit(1);
          }
          const firstSeverityRating = severity[0].severity.rating.toLocaleLowerCase();
          return `${severity.length} ${firstSeverityRating} severity issues`;
        }).join(', ');

      impactText.push(`The ${key} release line of Node.js is vulnerable to ${groupedByRating}.`);
    }

    return impactText.join('\n');
  }

  getVulnerabilities(content) {
    const grouped = _.groupBy(content.reports, 'severity.rating');
    const text = [];
    for (const [key, value] of Object.entries(grouped)) {
      text.push(`- ${value.length} ${key.toLocaleLowerCase()} severity issues.`);
    }
    return text.join('\n');
  }

  getAffectedVersions(content) {
    const affectedVersions = new Set();
    for (const report of Object.values(content.reports)) {
      for (const affectedVersion of report.affectedVersions) {
        affectedVersions.add(affectedVersion);
      }
    }
    return Array.from(affectedVersions).join(', ');
  }

  getSecurityPreReleaseTemplate() {
    return fs.readFileSync(
      new URL(
        './github/templates/security-pre-release.md',
        import.meta.url
      ),
      'utf-8'
    );
  }

  getSecurityPostReleaseTemplate() {
    return fs.readFileSync(
      new URL(
        './github/templates/security-post-release.md',
        import.meta.url
      ),
      'utf-8'
    );
  }
}
