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

  promptOpenSSLUpdate(cli) {
    return cli.prompt('Does this security release containt OpenSSL updates?', {
      defaultAnswer: true
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

  getOpenSSLUpdateTemplate(openSSLUpdate) {
    if (openSSLUpdate) {
      return '\n## OpenSSL Security updates\n\n' +
        'This security release includes OpenSSL security updates\n';
    }
    return '';
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
      text.push(`* ${value.length} ${key.toLocaleLowerCase()} severity issues.`);
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
}
