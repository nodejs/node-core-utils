import fs from 'node:fs';
import path from 'node:path';
import _ from 'lodash';
import nv from '@pkgjs/nv';
import {
  PLACEHOLDERS,
  checkoutOnSecurityReleaseBranch,
  validateDate,
  SecurityRelease
} from './security-release/security-release.js';
import auth from './auth.js';
import Request from './request.js';

export default class SecurityBlog extends SecurityRelease {
  req;

  async createPreRelease(nodejsOrgFolder) {
    const { cli } = this;

    // checkout on security release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);

    // read vulnerabilities JSON file
    const content = this.readVulnerabilitiesJSON();
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
      impact: this.getImpact(content)
    };
    const month = releaseDate.toLocaleString('en-US', { month: 'long' }).toLowerCase();
    const year = releaseDate.getFullYear();
    const fileName = `${month}-${year}-security-releases`;
    const fileNameExt = fileName + '.md';
    const preRelease = this.buildPreRelease(template, data);

    const pathToBlogPosts = 'apps/site/pages/en/blog/vulnerability';
    const pathToBannerJson = 'apps/site/site.json';

    const file = path.resolve(process.cwd(), nodejsOrgFolder, pathToBlogPosts, fileNameExt);
    const site = path.resolve(process.cwd(), nodejsOrgFolder, pathToBannerJson);

    const endDate = new Date(data.annoucementDate);
    endDate.setDate(endDate.getDate() + 7);

    this.updateWebsiteBanner(site, {
      startDate: data.annoucementDate,
      endDate: endDate.toISOString(),
      text: `New security releases to be made available ${data.releaseDate}`,
      link: `https://nodejs.org/en/blog/vulnerability/${fileName}`,
      type: 'warning'
    });

    fs.writeFileSync(file, preRelease);
    cli.ok(`Announcement file created and banner has been updated. Folder: ${nodejsOrgFolder}`);
  }

  async createPostRelease(nodejsOrgFolder) {
    const { cli } = this;
    const credentials = await auth({
      github: true,
      h1: true
    });

    this.req = new Request(credentials);

    // checkout on security release branch
    checkoutOnSecurityReleaseBranch(cli, this.repository);

    // read vulnerabilities JSON file
    const content = this.readVulnerabilitiesJSON();
    if (!content.releaseDate) {
      cli.error('Release date is not set in vulnerabilities.json,' +
        ' run `git node security --update-date=YYYY/MM/DD` to set the release date.');
      process.exit(1);
    }

    validateDate(content.releaseDate);
    const releaseDate = new Date(content.releaseDate);
    const template = this.getSecurityPostReleaseTemplate();
    const data = {
      annoucementDate: releaseDate.toISOString(),
      releaseDate: this.formatReleaseDate(releaseDate),
      affectedVersions: this.getAffectedVersions(content),
      vulnerabilities: this.getVulnerabilities(content),
      slug: this.getSlug(releaseDate),
      author: 'The Node.js Project',
      dependencyUpdates: content.dependencies
    };

    const pathToBlogPosts = path.resolve(nodejsOrgFolder, 'apps/site/pages/en/blog/release');
    const pathToBannerJson = path.resolve(nodejsOrgFolder, 'apps/site/site.json');

    const preReleasePath = path.resolve(pathToBlogPosts, data.slug + '.md');
    let preReleaseContent = this.findExistingPreRelease(preReleasePath);
    if (!preReleaseContent) {
      cli.error(`Existing pre-release not found! Path: ${preReleasePath} `);
      process.exit(1);
    }

    const postReleaseContent = await this.buildPostRelease(template, data, content);
    // cut the part before summary
    const preSummary = preReleaseContent.indexOf('# Summary');
    if (preSummary !== -1) {
      preReleaseContent = preReleaseContent.substring(preSummary);
    }
    const updatedContent = postReleaseContent + preReleaseContent;

    const endDate = new Date(data.annoucementDate);
    endDate.setDate(endDate.getDate() + 7);
    const month = releaseDate.toLocaleString('en-US', { month: 'long' });
    const capitalizedMonth = month[0].toUpperCase() + month.slice(1);

    this.updateWebsiteBanner(pathToBannerJson, {
      startDate: releaseDate,
      endDate,
      text: `${capitalizedMonth} Security Release is available`
    });

    fs.writeFileSync(preReleasePath, updatedContent);
    cli.ok(`Announcement file and banner has been updated. Folder: ${nodejsOrgFolder}`);
  }

  findExistingPreRelease(filepath) {
    if (!fs.existsSync(filepath)) {
      return null;
    }

    return fs.readFileSync(filepath, 'utf-8');
  }

  promptAuthor(cli) {
    return cli.prompt('Who is the author of this security release? If multiple' +
      ' use & as separator', {
      questionType: 'input',
      defaultAnswer: PLACEHOLDERS.author
    });
  }

  updateWebsiteBanner(siteJsonPath, content) {
    const siteJson = JSON.parse(fs.readFileSync(siteJsonPath));

    const currentValue = siteJson.websiteBanners.index;
    siteJson.websiteBanners.index = {
      startDate: content.startDate ?? currentValue.startDate,
      endDate: content.endDate ?? currentValue.endDate,
      text: content.text ?? currentValue.text,
      link: content.link ?? currentValue.link,
      type: content.type ?? currentValue.type
    };
    fs.writeFileSync(siteJsonPath, JSON.stringify(siteJson, null, 2) + '\n');
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
      impact
    } = data;
    return template.replaceAll(PLACEHOLDERS.annoucementDate, annoucementDate)
      .replaceAll(PLACEHOLDERS.slug, slug)
      .replaceAll(PLACEHOLDERS.affectedVersions, affectedVersions)
      .replaceAll(PLACEHOLDERS.vulnerabilities, vulnerabilities)
      .replaceAll(PLACEHOLDERS.releaseDate, releaseDate)
      .replaceAll(PLACEHOLDERS.impact, impact);
  }

  async buildPostRelease(template, data, content) {
    const {
      annoucementDate,
      releaseDate,
      affectedVersions,
      vulnerabilities,
      slug,
      impact,
      author,
      dependencyUpdates
    } = data;
    return template.replaceAll(PLACEHOLDERS.annoucementDate, annoucementDate)
      .replaceAll(PLACEHOLDERS.slug, slug)
      .replaceAll(PLACEHOLDERS.affectedVersions, affectedVersions)
      .replaceAll(PLACEHOLDERS.vulnerabilities, vulnerabilities)
      .replaceAll(PLACEHOLDERS.releaseDate, releaseDate)
      .replaceAll(PLACEHOLDERS.impact, impact)
      .replaceAll(PLACEHOLDERS.author, author)
      .replaceAll(PLACEHOLDERS.reports, await this.getReportsTemplate(content))
      .replaceAll(PLACEHOLDERS.dependencyUpdates,
        this.getDependencyUpdatesTemplate(dependencyUpdates))
      .replaceAll(PLACEHOLDERS.downloads, await this.getDownloadsTemplate(affectedVersions));
  }

  async getReportsTemplate(content) {
    const reports = content.reports;
    let template = '';
    for (const report of reports) {
      const cveId = report.cveIds?.join(', ');
      if (!cveId) {
        this.cli.error(`CVE ID for vulnerability ${report.link} ${report.title} not found`);
        process.exit(1);
      }
      template += `## ${report.title} (${cveId}) - (${report.severity.rating})\n\n`;
      if (!report.summary) {
        this.cli.error(`Summary missing for vulnerability ${report.link} ` +
        `${report.title}. Please create it before continuing.`);
        process.exit(1);
      }

      template += `${report.summary}\n\n`;
      const releaseLines = report.affectedVersions.join(', ');
      template += `Impact:\n\n- This vulnerability affects all users\
 in active release lines: ${releaseLines}\n\n`;
      if (!report.patchAuthors) {
        this.cli.error(`Missing patch author for vulnerability ${report.link} ${report.title}`);
        process.exit(1);
      }
      template += `Thank you, to ${report.reporter} for reporting this vulnerability\
 and thank you ${report.patchAuthors.join(' and ')} for fixing it.\n\n`;
    }
    return template;
  }

  getDependencyUpdatesTemplate(dependencyUpdates) {
    if (typeof dependencyUpdates !== 'object') return '';
    if (Object.keys(dependencyUpdates).length === 0) return '';
    let template = '\nThis security release includes the following dependency' +
      ' updates to address public vulnerabilities:\n';
    for (const dependencyUpdate of Object.values(dependencyUpdates)) {
      for (const dependency of dependencyUpdate) {
        const title = dependency.title.substring(dependency.title.indexOf(':') + ':'.length).trim();
        template += `- ${title}\
 on ${dependency.affectedVersions.join(', ')}\n`;
      }
    }
    return template;
  }

  async getDownloadsTemplate(affectedVersions) {
    let template = '';
    const versionsToBeReleased = (await nv('supported')).filter(
      (v) => affectedVersions.split(', ').includes(`${v.major}.x`)
    );
    for (const version of versionsToBeReleased) {
      const v = `v${version.major}.${version.minor}.${Number(version.patch) + 1}`;
      template += `- [Node.js ${v}](/blog/release/${v}/)\n`;
    }

    return template;
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
    const impact = new Map();
    for (const report of content.reports) {
      for (const version of report.affectedVersions) {
        if (!impact.has(version)) impact.set(version, []);
        impact.get(version).push(report);
      }
    }

    const result = Array.from(impact.entries())
      .sort(([a], [b]) => b.localeCompare(a)) // DESC
      .map(([version, reports]) => {
        const severityCount = new Map();

        for (const report of reports) {
          const rating = report.severity.rating?.toLowerCase();
          if (!rating) {
            this.cli.error(`severity.rating not found for report ${report.id}.`);
            process.exit(1);
          }
          severityCount.set(rating, (severityCount.get(rating) || 0) + 1);
        }

        const groupedByRating = Array.from(severityCount.entries())
          .map(([rating, count]) => `${count} ${rating} severity issues`)
          .join(', ');

        return `The ${version} release line of Node.js is vulnerable to ${groupedByRating}.`;
      })
      .join('\n');

    return result;
  }

  getVulnerabilities(content) {
    const grouped = _.groupBy(content.reports, 'severity.rating');
    const text = [];
    for (const [key, value] of Object.entries(grouped)) {
      text.push(`- ${value.length} ${key.toLocaleLowerCase()} severity issues.`);
    }
    return text.join('\n');
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
