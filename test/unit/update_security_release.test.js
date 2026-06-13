import { describe, it } from 'node:test';
import assert from 'node:assert';

import UpdateSecurityRelease, {
  releaseBlogUrlFromDate
} from '../../lib/update_security_release.js';
import SecurityBlog from '../../lib/security_blog.js';

describe('releaseBlogUrlFromDate', () => {
  it('derives the per-release blog URL from YYYY/MM/DD', () => {
    assert.strictEqual(
      releaseBlogUrlFromDate('2024/04/10'),
      'https://nodejs.org/en/blog/vulnerability/april-2024-security-releases'
    );
  });

  it('produces the same slug shape SecurityBlog#getSlug uses', () => {
    const blog = new SecurityBlog();
    const date = new Date('2024-04-10');
    const slug = blog.getSlug(date);
    const url = releaseBlogUrlFromDate('2024/04/10');
    assert.strictEqual(url, `https://nodejs.org/en/blog/vulnerability/${slug}`);
  });

  it('returns null for the TBD sentinel', () => {
    assert.strictEqual(releaseBlogUrlFromDate('TBD'), null);
  });

  it('returns null for empty / undefined input', () => {
    assert.strictEqual(releaseBlogUrlFromDate(''), null);
    assert.strictEqual(releaseBlogUrlFromDate(undefined), null);
    assert.strictEqual(releaseBlogUrlFromDate(null), null);
  });

  it('returns null for unparseable strings', () => {
    assert.strictEqual(releaseBlogUrlFromDate('not-a-date'), null);
  });
});

describe('UpdateSecurityRelease#buildCnaContainerFromReport', () => {
  const RELEASE_URL =
    'https://nodejs.org/en/blog/vulnerability/april-2024-security-releases';

  const baseReport = () => ({
    id: 12345,
    title: 'node: vulnerable to demo',
    summary: 'A demo vulnerability.',
    link: 'https://hackerone.com/reports/12345',
    affectedVersions: ['18.x', '20.x'],
    patchedVersions: ['18.20.10', '20.18.2'],
    severity: {
      weakness_id: 400,
      cvss_vector_string: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
      rating: 'high'
    }
  });

  it('produces a v5.2 CNA Container with title, descriptions, and CWE/CVSS', () => {
    const release = new UpdateSecurityRelease();
    const container = release.buildCnaContainerFromReport(
      baseReport(), 'CVE-2024-12345', RELEASE_URL
    );
    assert.strictEqual(container.title, 'node: vulnerable to demo');
    assert.deepStrictEqual(container.descriptions, [
      { lang: 'en', value: 'A demo vulnerability.' }
    ]);
    assert.strictEqual(container.problemTypes[0].descriptions[0].cweId, 'CWE-400');
    assert.strictEqual(
      container.metrics[0].cvssV3_1.vectorString,
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H'
    );
  });

  it('uses the per-release blog URL as the only reference, never the HackerOne link', () => {
    const release = new UpdateSecurityRelease();
    const container = release.buildCnaContainerFromReport(
      baseReport(), 'CVE-2024-12345', RELEASE_URL
    );
    assert.deepStrictEqual(container.references, [
      { url: RELEASE_URL, tags: ['vendor-advisory'] }
    ]);
    // Belt-and-braces: report.link is the private H1 report and must not leak.
    const stringified = JSON.stringify(container);
    assert.ok(!stringified.includes('hackerone.com'),
      'CNA Container leaked the private HackerOne report URL');
  });

  it('pairs affected and patched versions by numeric major', () => {
    const release = new UpdateSecurityRelease();
    const container = release.buildCnaContainerFromReport(
      baseReport(), 'CVE-2024-12345', RELEASE_URL
    );
    assert.deepStrictEqual(container.affected[0].versions, [
      { version: '18.x', status: 'affected', lessThan: '18.20.10' },
      { version: '20.x', status: 'affected', lessThan: '20.18.2' }
    ]);
  });

  it('does not match patched versions across different majors via prefix', () => {
    const release = new UpdateSecurityRelease();
    const container = release.buildCnaContainerFromReport({
      ...baseReport(),
      affectedVersions: ['1.x'],
      patchedVersions: ['18.20.10']
    }, 'CVE-2024-12345', RELEASE_URL);
    assert.strictEqual(container.affected[0].versions[0].lessThan, undefined);
  });

  it('omits problemTypes when the report has no CWE id', () => {
    const release = new UpdateSecurityRelease();
    const container = release.buildCnaContainerFromReport({
      ...baseReport(),
      severity: { cvss_vector_string: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' }
    }, 'CVE-2024-12345', RELEASE_URL);
    assert.strictEqual(container.problemTypes, undefined);
  });

  it('omits metrics when the report has no CVSS vector', () => {
    const release = new UpdateSecurityRelease();
    const container = release.buildCnaContainerFromReport({
      ...baseReport(),
      severity: { weakness_id: 400 }
    }, 'CVE-2024-12345', RELEASE_URL);
    assert.strictEqual(container.metrics, undefined);
  });

  it('falls back to title when summary is empty', () => {
    const release = new UpdateSecurityRelease();
    const container = release.buildCnaContainerFromReport({
      ...baseReport(),
      summary: ''
    }, 'CVE-2024-12345', RELEASE_URL);
    assert.strictEqual(container.descriptions[0].value, 'node: vulnerable to demo');
  });
});
