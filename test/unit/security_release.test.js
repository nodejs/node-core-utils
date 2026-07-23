import { describe, it } from 'node:test';
import assert from 'node:assert';

import SecurityBlog from '../../lib/security_blog.js';
import PrepareSecurityRelease, {
  buildIncludedTriagedReport,
  groupMissingReportInformation,
  getMissingReportInformation,
  getNextTuesdayReleaseDateChoices,
  getNextTuesdayReleaseDates
} from '../../lib/prepare_security.js';
import UpdateSecurityRelease from '../../lib/update_security_release.js';
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

function h1Report(overrides = {}) {
  return {
    id: '123',
    attributes: {
      title: 'Example vulnerability',
      cve_ids: ['CVE-2026-0001'],
      ...overrides.attributes
    },
    relationships: {
      reporter: {
        data: {
          attributes: {
            username: 'reporter'
          }
        }
      },
      custom_field_values: {
        data: [
          {
            attributes: {
              value: 'https://github.com/nodejs-private/node-private/pull/1'
            }
          }
        ]
      },
      severity: {
        data: {
          attributes: {
            rating: 'high',
            cvss_vector_string: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
          }
        }
      },
      weakness: {
        data: {
          id: '79'
        }
      },
      summaries: {
        data: [
          {
            attributes: {
              category: 'team',
              content: 'A useful team summary.'
            }
          }
        ]
      },
      ...overrides.relationships
    }
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

describe('security_release: CVE request versions', () => {
  it('shows reports selected for bulk CVE requests', () => {
    const messages = [];
    const release = new UpdateSecurityRelease({
      info(message) {
        messages.push(message);
      }
    });

    release.showCVERequestSummary([
      {
        id: '3846922',
        title: 'HTTP/2 retained header blocks evade maxSessionMemory',
        severity: { rating: 'high' }
      },
      {
        id: '3838601',
        title: 'Permission Model bypass writes trace logs',
        severity: { rating: 'medium' }
      }
    ]);

    assert.deepStrictEqual(messages, [
      'Reports selected for CVE requests (2):',
      '- 3846922 [high] HTTP/2 retained header blocks evade maxSessionMemory',
      '- 3838601 [medium] Permission Model bypass writes trace logs'
    ]);
  });

  it('shows the bulk CVE summary before asking to request all reports', async() => {
    const events = [];
    const release = new UpdateSecurityRelease({
      info(message) {
        events.push(`info:${message}`);
      },
      warn() {},
      prompt(message) {
        events.push(`prompt:${message}`);
        return false;
      }
    });
    release.collectSuccessfulCVERequests = async() => [];

    await release.promptRequestAllCVEs([
      {
        id: '1',
        title: 'First report',
        cveIds: [],
        severity: {
          rating: 'high',
          weakness_id: '1',
          cvss_vector_string: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H'
        },
        affectedVersions: ['24.x'],
        summary: 'First summary'
      },
      {
        id: '2',
        title: 'Second report',
        cveIds: [],
        severity: {
          rating: 'medium',
          weakness_id: '1',
          cvss_vector_string: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N'
        },
        affectedVersions: ['24.x'],
        summary: 'Second summary'
      }
    ]);

    assert.deepStrictEqual(events.slice(0, 4), [
      'info:Reports selected for CVE requests (2):',
      'info:- 1 [high] First report',
      'info:- 2 [medium] Second report',
      'prompt:Request CVEs for all reports without prompting for each report?'
    ]);
  });

  it('reuses version answers for repeated release lines', async() => {
    const prompts = [];
    const radioPrompts = [];
    const release = new UpdateSecurityRelease({
      prompt(message, options) {
        prompts.push(message);
        assert.strictEqual(options.questionType, 'input');
        if (message.includes('24.x')) return '24.18.0';
        if (message.includes('22.x')) return '22.23.1';
        throw new Error(`Unexpected prompt: ${message}`);
      },
      promptRadio(message, choices) {
        radioPrompts.push(message);
        return choices[0];
      }
    });
    const supportedVersions = [
      { major: 24, version: '24.18.0' },
      { major: 22, version: '22.23.1' }
    ];
    const versionCache = new Map();

    assert.deepStrictEqual(
      (await release.calculateVersions(['24.x'], supportedVersions, [], versionCache))
        .patchedVersions,
      ['24.18.1']
    );
    assert.deepStrictEqual(
      (await release.calculateVersions(['24.x', '22.x'], supportedVersions, [], versionCache))
        .patchedVersions,
      ['24.18.1', '22.23.2']
    );
    assert.deepStrictEqual(prompts, [
      'What is the affected version (<=) for release line 24.x?',
      'What is the affected version (<=) for release line 22.x?'
    ]);
    assert.deepStrictEqual(radioPrompts, [
      'What is the patched version (>=) for release line 24.x?',
      'What is the patched version (>=) for release line 22.x?'
    ]);
  });

  it('applies successful CVE updates once after requests finish', async() => {
    const messages = [];
    const prompts = [];
    const h1Updates = [];
    const release = new UpdateSecurityRelease({
      info(message) {
        messages.push(message);
      },
      warn() {},
      prompt(message) {
        prompts.push(message);
        return true;
      }
    });
    const content = { reports: [] };
    const successfulReports = [
      { id: '1', cveIds: ['CVE-2026-0001'] },
      { id: '2', cveIds: ['CVE-2026-0002'] }
    ];
    let jsonUpdates = 0;

    release.updateVulnerabilitiesJSON = async(updatedContent) => {
      assert.strictEqual(updatedContent, content);
      jsonUpdates++;
      return true;
    };
    release.updateHackonerReportCveWithoutConfirmation = async(req, report) => {
      h1Updates.push(report.id);
      return true;
    };

    await release.applySuccessfulCVEUpdates({}, content, successfulReports);

    assert.deepStrictEqual(messages, [
      'CVE requests succeeded:',
      '- 1: CVE-2026-0001',
      '- 2: CVE-2026-0002',
      'HackerOne reports updated:',
      '- 1: CVE-2026-0001',
      '- 2: CVE-2026-0002'
    ]);
    assert.deepStrictEqual(prompts, [
      'Update vulnerabilities.json with the successful CVE requests?',
      'Update HackerOne reports with the successful CVE IDs?',
      'Allow action: update 2 HackerOne reports with CVE IDs?\n\n' +
        'This writes the assigned CVE IDs back to all successful HackerOne reports.'
    ]);
    assert.strictEqual(jsonUpdates, 1);
    assert.deepStrictEqual(h1Updates, ['1', '2']);
  });

  it('skips HackerOne updates when vulnerabilities.json update is declined', async() => {
    const warnings = [];
    const release = new UpdateSecurityRelease({
      info() {},
      warn(message) {
        warnings.push(message);
      },
      prompt() {
        return false;
      }
    });
    let h1Updates = 0;
    release.updateVulnerabilitiesJSON = async() => {
      throw new Error('should not update vulnerabilities.json');
    };
    release.updateHackonerReportCveWithoutConfirmation = async() => {
      h1Updates++;
    };

    await release.applySuccessfulCVEUpdates({}, {}, [
      { id: '1', cveIds: ['CVE-2026-0001'] }
    ]);

    assert.deepStrictEqual(warnings, [
      'Skipping HackerOne updates because vulnerabilities.json was not updated.'
    ]);
    assert.strictEqual(h1Updates, 0);
  });

  it('skips HackerOne updates when vulnerabilities.json update fails', async() => {
    const warnings = [];
    let promptCount = 0;
    const release = new UpdateSecurityRelease({
      info() {},
      warn(message) {
        warnings.push(message);
      },
      prompt() {
        promptCount++;
        return true;
      }
    });
    let h1Updates = 0;
    release.updateVulnerabilitiesJSON = async() => false;
    release.updateHackonerReportCveWithoutConfirmation = async() => {
      h1Updates++;
    };

    await release.applySuccessfulCVEUpdates({}, {}, [
      { id: '1', cveIds: ['CVE-2026-0001'] }
    ]);

    assert.deepStrictEqual(warnings, [
      'Skipping HackerOne updates because vulnerabilities.json update failed.'
    ]);
    assert.strictEqual(promptCount, 1);
    assert.strictEqual(h1Updates, 0);
  });

  it('summarizes HackerOne update failures', async() => {
    const messages = [];
    const warnings = [];
    const release = new UpdateSecurityRelease({
      info(message) {
        messages.push(message);
      },
      warn(message) {
        warnings.push(message);
      },
      prompt() {
        return true;
      }
    });
    release.updateVulnerabilitiesJSON = async() => true;
    release.updateHackonerReportCveWithoutConfirmation = async(req, report) => report.id === '1';

    await release.applySuccessfulCVEUpdates({}, {}, [
      { id: '1', cveIds: ['CVE-2026-0001'] },
      { id: '2', cveIds: ['CVE-2026-0002'] }
    ]);

    assert.deepStrictEqual(messages, [
      'CVE requests succeeded:',
      '- 1: CVE-2026-0001',
      '- 2: CVE-2026-0002',
      'HackerOne reports updated:',
      '- 1: CVE-2026-0001'
    ]);
    assert.deepStrictEqual(warnings, [
      'HackerOne reports not updated:',
      '- 2: CVE-2026-0002'
    ]);
  });

  it('keeps successful CVE requests when interrupted', async() => {
    const warnings = [];
    const reports = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const release = new UpdateSecurityRelease({
      warn(message) {
        warnings.push(message);
      }
    });
    release.requestReportCVE = async({ report }) => {
      if (report.id === '1') return true;
      const error = new Error('User force closed the prompt');
      error.name = 'ExitPromptError';
      throw error;
    };

    assert.deepStrictEqual(
      await release.collectSuccessfulCVERequests({
        reports,
        req: {},
        programId: '123',
        supportedVersions: [],
        eolVersions: [],
        versionCache: new Map(),
        requestAll: false
      }),
      [reports[0]]
    );
    assert.deepStrictEqual(warnings, [
      'CVE request interrupted. Finalizing successful requests.'
    ]);
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

    assert.strictEqual(
      await release.promptReleaseDate(),
      getNextTuesdayReleaseDates()[0]
    );
  });
});

describe('security_release: include all triaged reports', () => {
  it('builds a vulnerabilities.json report from a triaged H1 report', () => {
    assert.deepStrictEqual(
      buildIncludedTriagedReport(h1Report(), {
        affectedVersions: '24.x,22.x',
        patchAuthors: ['author']
      }),
      {
        id: '123',
        title: 'Example vulnerability',
        cveIds: ['CVE-2026-0001'],
        severity: {
          rating: 'high',
          cvss_vector_string: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          weakness_id: '79'
        },
        summary: 'A useful team summary.',
        patchAuthors: ['author'],
        prURL: 'https://github.com/nodejs-private/node-private/pull/1',
        affectedVersions: ['24.x', '22.x'],
        link: 'https://hackerone.com/reports/123',
        reporter: 'reporter'
      }
    );
  });

  it('identifies missing information in included reports', () => {
    const includedReport = buildIncludedTriagedReport(
      h1Report({
        attributes: {
          cve_ids: []
        },
        relationships: {
          custom_field_values: {
            data: []
          },
          severity: {
            data: {
              attributes: {
                rating: '',
                cvss_vector_string: ''
              }
            }
          },
          weakness: {
            data: {}
          },
          summaries: {
            data: []
          }
        }
      }),
      { affectedVersions: '', patchAuthors: [] }
    );

    assert.deepStrictEqual(
      getMissingReportInformation(includedReport),
      [
        'severity rating',
        'CVSS vector',
        'weakness ID',
        'team summary',
        'PR URL',
        'patch authors',
        'affected versions'
      ]
    );
  });

  it('groups missing information by field', () => {
    assert.deepStrictEqual(
      groupMissingReportInformation([
        {
          id: '1',
          missing: ['CVSS vector', 'team summary']
        },
        {
          id: '2',
          missing: ['CVSS vector']
        }
      ]),
      [
        {
          field: 'CVSS vector',
          reports: [
            {
              id: '1',
              missing: ['CVSS vector', 'team summary']
            },
            {
              id: '2',
              missing: ['CVSS vector']
            }
          ]
        },
        {
          field: 'team summary',
          reports: [
            {
              id: '1',
              missing: ['CVSS vector', 'team summary']
            }
          ]
        }
      ]
    );
  });

  it('prints a compact missing information summary', () => {
    const output = [];
    const release = new PrepareSecurityRelease({
      ok: (message) => output.push(['ok', message]),
      warn: (message) => output.push(['warn', message]),
      info: (message) => output.push(['info', message])
    });

    release.displayMissingReportInformationSummary([
      {
        id: '1',
        title: 'Long report title',
        link: 'https://hackerone.com/reports/1',
        missing: ['CVSS vector', 'team summary']
      },
      {
        id: '2',
        title: 'Another long report title',
        link: 'https://hackerone.com/reports/2',
        missing: ['CVSS vector']
      }
    ]);

    assert.deepStrictEqual(output, [
      ['warn', '2 included reports are missing information:'],
      ['info', '- CVSS vector (2): H1 #1, H1 #2'],
      ['info', '- team summary (1): H1 #1']
    ]);
  });

  it('prompts for report selection mode', async() => {
    const release = new PrepareSecurityRelease({
      promptSelect(message, choices, options) {
        assert.strictEqual(
          message,
          'How would you like to choose reports for the next security release?'
        );
        assert.deepStrictEqual(
          choices.map(({ value }) => value),
          ['review', 'include-all']
        );
        assert.strictEqual(options.defaultAnswer, 'review');
        return 'include-all';
      }
    });

    assert.strictEqual(await release.promptReportSelectionMode(), 'include-all');
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
