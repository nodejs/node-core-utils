import { describe, it } from 'node:test';
import assert from 'node:assert';

import SecurityBlog from '../../lib/security_blog.js';
import {
  getHighestSeverity,
  getHighestSeverityAnnouncement
} from '../../lib/security-release/security-release.js';

const cli = {
  error() {}
};

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

    assert.strictEqual(getHighestSeverity(reports), 'HIGH');
    assert.strictEqual(
      getHighestSeverityAnnouncement(reports),
      'The highest severity issue fixed in this release is HIGH.'
    );
  });

  it('uses medium severity wording', () => {
    const reports = [
      report(1, 'low'),
      report(2, 'medium')
    ];

    assert.strictEqual(getHighestSeverity(reports), 'MEDIUM');
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
      blog.getVulnerabilities(content),
      'The highest severity issue fixed in this release is MEDIUM.'
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
});
