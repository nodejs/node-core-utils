import { describe, it } from 'node:test';
import assert from 'node:assert';

import SecurityBlog from '../../lib/security_blog.js';
import {
  getHighestSeverityAnnouncement
} from '../../lib/security-release/security-release.js';

const cli = {
  error() {}
};

function assertExits(fn) {
  const originalExit = process.exit;
  process.exit = () => {
    throw new Error('process.exit');
  };

  try {
    assert.throws(fn, /process\.exit/);
  } finally {
    process.exit = originalExit;
  }
}

function report(id, rating, affectedVersions = ['24.x']) {
  return {
    id,
    severity: { rating },
    affectedVersions
  };
}

describe('security_release: severity announcement', () => {
  it('uses the highest severity across reports', () => {
    const reports = [
      report(1, 'low'),
      report(2, 'medium'),
      report(3, 'high')
    ];

    assert.strictEqual(
      getHighestSeverityAnnouncement(reports),
      'The highest severity issue fixed in this release is HIGH.'
    );
  });

  it('can be customized with second argument', () => {
    const reports = [
      report(1, 'low'),
      report(2, 'medium'),
      report(3, 'high')
    ];

    assert.strictEqual(
      getHighestSeverityAnnouncement(reports, 'special release'),
      'The highest severity issue fixed in special release is HIGH.'
    );
  });

  it('invalid severity ratings are ignored', () => {
    const reports = [
      report(1, 'low'),
      report(2, 'medium'),
      report(3, 'hypercritical')
    ];

    assert.strictEqual(
      getHighestSeverityAnnouncement(reports),
      'The highest severity issue fixed in this release is MEDIUM.'
    );
  });

  it('if no valid rating is passed, output NONE', () => {
    const reports = [
      report(3, 'hypercritical')
    ];

    assert.strictEqual(
      getHighestSeverityAnnouncement(reports),
      'The highest severity issue fixed in this release is NONE.'
    );
  });

  it('uses medium severity wording', () => {
    const reports = [
      report(1, 'low'),
      report(2, 'medium')
    ];

    assert.strictEqual(
      getHighestSeverityAnnouncement(reports),
      'The highest severity issue fixed in this release is MEDIUM.'
    );
  });

  it('ignores invalid severity ratings', () => {
    const reports = [
      report(1, 'low'),
      report(2, 'hypercritical'),
      report(3, 'medium')
    ];

    assert.strictEqual(
      getHighestSeverityAnnouncement(reports),
      'The highest severity issue fixed in this release is MEDIUM.'
    );
  });
});

describe('security_blog: pre-release severity wording', () => {
  it('does not include severity counts in the summary', () => {
    const blog = new SecurityBlog(cli);
    const content = {
      reports: [
        report(1, 'low'),
        report(2, 'medium')
      ]
    };

    assert.strictEqual(
      blog.getPreReleaseVulnerabilities(content),
      'The highest severity issue fixed in this release is MEDIUM.'
    );
    assert.strictEqual(
      blog.getVulnerabilities(content),
      '- 1 low severity issues.\n- 1 medium severity issues.'
    );
  });

  it('uses the highest severity per release line in impact text', () => {
    const blog = new SecurityBlog(cli);
    const content = {
      reports: [
        report(1, 'low', ['22.x', '20.x']),
        report(2, 'medium', ['22.x']),
        report(3, 'high', ['20.x'])
      ]
    };

    assert.strictEqual(
      blog.getImpact(content),
      'The highest severity issue fixed in the 22.x release line is MEDIUM.\n' +
        'The highest severity issue fixed in the 20.x release line is HIGH.'
    );
  });

  it('replaces the pre-release template placeholder with the highest severity sentence', () => {
    const blog = new SecurityBlog(cli);
    const template = blog.getSecurityPreReleaseTemplate();
    const preRelease = blog.buildPreRelease(template, {
      annoucementDate: '2026-06-01T00:00:00.000Z',
      releaseDate: 'Tuesday, June 2, 2026',
      affectedVersions: '24.x, 22.x',
      vulnerabilities: blog.getPreReleaseVulnerabilities({
        reports: [
          report(1, 'low'),
          report(2, 'high')
        ]
      }),
      slug: 'june-2026-security-releases',
      impact: 'The highest severity issue fixed in the 24.x release line is HIGH.'
    });

    assert.match(
      preRelease,
      /The highest severity issue fixed in this release is HIGH\./
    );
    assert.doesNotMatch(preRelease, /%VULNERABILITIES%/);
  });

  it('exits when a report is missing a severity rating', () => {
    const errors = [];
    const blog = new SecurityBlog({
      error(message) {
        errors.push(message);
      }
    });
    const content = {
      reports: [
        {
          id: 1,
          severity: {},
          affectedVersions: ['24.x']
        }
      ]
    };

    assertExits(() => blog.getPreReleaseVulnerabilities(content));
    assertExits(() => blog.getImpact(content));
    assert.deepStrictEqual(errors, [
      'severity.rating not found for report 1.',
      'severity.rating not found for report 1.'
    ]);
  });
});

describe('security_blog: post-release severity wording', () => {
  it('keeps the vulnerability count list', () => {
    const blog = new SecurityBlog(cli);
    const content = {
      reports: [
        report(1, 'low'),
        report(2, 'medium'),
        report(3, 'medium')
      ]
    };

    assert.strictEqual(
      blog.getVulnerabilities(content),
      '- 1 low severity issues.\n- 2 medium severity issues.'
    );
  });

  it('exits when a report is missing a severity rating', () => {
    const errors = [];
    const blog = new SecurityBlog({
      error(message) {
        errors.push(message);
      }
    });
    const content = {
      reports: [
        {
          id: 1,
          severity: {},
          affectedVersions: ['24.x']
        }
      ]
    };

    assertExits(() => blog.getVulnerabilities(content));
    assert.deepStrictEqual(errors, [
      'severity.rating not found for report 1.'
    ]);
  });
});
