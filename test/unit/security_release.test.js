import { describe, it } from 'node:test';
import assert from 'node:assert';

import SecurityBlog from '../../lib/security_blog.js';
import PrepareSecurityRelease, {
  getNextTuesdayReleaseDateChoices,
  getNextTuesdayReleaseDates
} from '../../lib/prepare_security.js';
import {
  getAffectedVersionLines,
  getHighestSeverityAnnouncement
} from '../../lib/security-release/security-release.js';

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

describe('security_release: affected versions', () => {
  it('normalizes legacy arrays, strings, and keyed version objects', () => {
    assert.deepStrictEqual(
      getAffectedVersionLines(['v24.x', '22.x']),
      ['24.x', '22.x']
    );
    assert.deepStrictEqual(
      getAffectedVersionLines('24.x, v22.x'),
      ['24.x', '22.x']
    );
    assert.deepStrictEqual(
      getAffectedVersionLines({
        '24.x': { affected: '<=24.4.0', patched: '24.4.1' },
        '22.x': { affected: '<=22.17.0', patched: '22.17.1' }
      }),
      ['24.x', '22.x']
    );
  });
});

describe('security_release: release date choices', () => {
  it('starts with the next Tuesday when today is Tuesday', () => {
    assert.deepStrictEqual(
      getNextTuesdayReleaseDates(new Date(2026, 6, 7), 4),
      ['2026/07/14', '2026/07/21', '2026/07/28', '2026/08/04']
    );
  });

  it('uses the upcoming Tuesday when today is before Tuesday', () => {
    assert.deepStrictEqual(
      getNextTuesdayReleaseDates(new Date(2026, 6, 8), 3),
      ['2026/07/14', '2026/07/21', '2026/07/28']
    );
  });

  it('describes upcoming Tuesdays with relative timing', () => {
    assert.deepStrictEqual(
      getNextTuesdayReleaseDateChoices(new Date(2026, 6, 7), 2),
      [
        {
          name: '2026/07/14',
          value: '2026/07/14',
          description: 'Tuesday, in 7 days'
        },
        {
          name: '2026/07/21',
          value: '2026/07/21',
          description: 'Tuesday, in 14 days'
        },
        {
          name: 'TBD',
          value: 'TBD',
          description: 'Release date not defined yet'
        }
      ]
    );
  });

  it('prompts with upcoming Tuesdays and TBD', async() => {
    const release = new PrepareSecurityRelease({
      promptSelect(message, choices, options) {
        assert.strictEqual(message, 'Select target release date:');
        assert.deepStrictEqual(
          choices.map(({ value }) => value),
          [...getNextTuesdayReleaseDates(), 'TBD']
        );
        assert.strictEqual(options.defaultAnswer, choices[0].value);
        return choices[0].value;
      }
    });

    assert.strictEqual(await release.promptReleaseDate(), getNextTuesdayReleaseDates()[0]);
  });
});

describe('security_blog: pre-release severity wording', () => {
  it('does not include severity counts in the summary', () => {
    const blog = new SecurityBlog();
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
    const blog = new SecurityBlog();
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

  it('supports keyed affected version objects with legacy arrays', () => {
    const blog = new SecurityBlog();
    const content = {
      reports: [
        report(1, 'low', {
          '24.x': { affected: '<=24.4.0', patched: '24.4.1' },
          '22.x': { affected: '<=22.17.0', patched: '22.17.1' }
        }),
        report(2, 'high', ['22.x'])
      ]
    };

    assert.strictEqual(blog.getAffectedVersions(content), '24.x, 22.x');
    assert.strictEqual(
      blog.getImpact(content),
      'The highest severity issue fixed in the 24.x release line is LOW.\n' +
        'The highest severity issue fixed in the 22.x release line is HIGH.'
    );
  });

  it('replaces the pre-release template placeholder with the highest severity sentence', () => {
    const blog = new SecurityBlog();
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
    const blog = new SecurityBlog();
    const content = {
      reports: [
        {
          id: 1,
          severity: {},
          affectedVersions: ['24.x']
        }
      ]
    };

    assert.throws(() => blog.getPreReleaseVulnerabilities(content), /severity\.rating not found for report 1/);
    assert.throws(() => blog.getImpact(content), /severity\.rating not found for report 1/);
  });
});

describe('security_blog: post-release severity wording', () => {
  it('keeps the vulnerability count list', () => {
    const blog = new SecurityBlog();
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
    const blog = new SecurityBlog();
    const content = {
      reports: [
        {
          id: 1,
          severity: {},
          affectedVersions: ['24.x']
        }
      ]
    };

    assert.throws(() => blog.getVulnerabilities(content), /severity\.rating not found for report 1/);
  });
});
