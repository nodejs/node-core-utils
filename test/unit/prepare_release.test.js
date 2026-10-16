import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import semver from 'semver';

import * as utils from '../../lib/release/utils.js';
import ReleasePreparation, {
  parsePullRequestURL,
  getPullRequestURLForLine,
  filterAlphaReleaseCommits,
  formatMajorReleaseCommits,
  formatReleaseInfo,
  formatSecurityNotableChanges,
  parseReverts
} from '../../lib/prepare_release.js';

function nodeVersionH({ major, minor, patch, isRelease = 0, alpha }) {
  return [
    '#ifndef SRC_NODE_VERSION_H_',
    '#define SRC_NODE_VERSION_H_',
    '',
    `#define NODE_MAJOR_VERSION ${major}`,
    `#define NODE_MINOR_VERSION ${minor}`,
    `#define NODE_PATCH_VERSION ${patch}`,
    '',
    '#define NODE_VERSION_IS_LTS 0',
    '#define NODE_VERSION_LTS_CODENAME ""',
    '',
    `#define NODE_VERSION_IS_RELEASE ${isRelease}`,
    '',
    ...(alpha
      ? [
          `#define NODE_ALPHA_MAJOR_VERSION ${alpha.major}`,
          `#define NODE_ALPHA_MINOR_VERSION ${alpha.minor}`,
          `#define NODE_ALPHA_PATCH_VERSION ${alpha.patch}`,
          ''
        ]
      : []),
    '#ifndef NODE_STRINGIFY',
    ''
  ].join('\n');
}

const changelogV27 = [
  '# Node.js 27 ChangeLog',
  '',
  '<table>',
  '<tr>',
  '<th>Current</th>',
  '</tr>',
  '<tr>',
  '<td>',
  '<a href="#27.0.0-alpha.0.0.0">27.0.0-alpha.0.0.0</a><br/>',
  '</td>',
  '</tr>',
  '</table>',
  '',
  '<a id="27.0.0-alpha.0.0.0"></a>',
  '',
  '## 2026-10-28, Version 27.0.0-alpha.0.0.0 (Alpha), @RafaelGSS',
  ''
].join('\n');

function nodeCheckout(t, files) {
  const previous = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncu-prepare-release-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  process.chdir(dir);
  return dir;
}

function releasePreparation(props) {
  const noop = () => {};
  return Object.assign(Object.create(ReleasePreparation.prototype), {
    cli: { startSpinner: noop, stopSpinner: noop, warn: noop },
    config: { username: 'RafaelGSS' },
    isAlpha: false,
    isOutOfAlpha: false,
    isFirstRelease: false,
    alphaVersionComponents: null,
    isLTS: false,
    ltsCodename: '',
    async tryResetBranch() {},
    getLastRef(tagName) { return tagName ?? 'v27.0.0-alpha.0.0.0'; }
  }, props);
}

describe('prepare_release: utils.getEOLDate', () => {
  it('calculates the correct EOL date', () => {
    const test = utils.getEOLDate('2020-10-27');
    const expected = new Date('2023-04-27');
    const format = { month: 'short', year: 'numeric' };
    assert.strictEqual(
      test.toLocaleString('en-US', format),
      expected.toLocaleString('en-US', format)
    );
  });
});

describe('prepare_release: utils.getLTSMaintenanceStartDate', () => {
  it('calculates the correct LTS maintenance start date', () => {
    const test = utils.getLTSMaintenanceStartDate('2020-10-27');
    const expected = new Date('2021-10-27');
    const format = { month: 'short', year: 'numeric' };
    assert.strictEqual(
      test.toLocaleString('en-US', format),
      expected.toLocaleString('en-US', format)
    );
  });
});

describe('prepare_release: utils.getStartLTSBlurb', () => {
  it('generates first LTS release text with correct dates', () => {
    const expected = [
      'This release marks the transition of Node.js 14.x into Long Term Support (LTS)',
      'with the codename \'Fermium\'. The 14.x release line now moves into "Active LTS"',
      'and will remain so until October 2021. After that time, it will move into',
      '"Maintenance" until end of life in April 2023.'
    ].join('\n');
    const text = utils.getStartLTSBlurb({
      date: '2020-10-27',
      ltsCodename: 'Fermium',
      versionComponents: { major: 14 }
    });
    assert.strictEqual(text, expected);
  });
});

describe('prepare_release: utils.updateTestProcessRelease', () => {
  it('inserts test for a new LTS codename', () => {
    const expectedPath = new URL(
      '../fixtures/release/expected-test-process-release.js',
      import.meta.url
    );
    const expected = readFileSync(expectedPath, { encoding: 'utf8' });
    const testPath = new URL(
      '../fixtures/release/original-test-process-release.js',
      import.meta.url
    );
    const test = readFileSync(testPath, { encoding: 'utf8' });
    const context = {
      ltsCodename: 'Fermium',
      versionComponents: {
        major: 14,
        minor: 15
      }
    };
    const updated = utils.updateTestProcessRelease(test, context);
    assert.strictEqual(updated, expected);
  });
});

describe('prepare_release: parsePullRequestURL', () => {
  it('parses a private node-private PR URL', () => {
    assert.deepStrictEqual(
      parsePullRequestURL('https://github.com/nodejs-private/node-private/pull/927'),
      { owner: 'nodejs-private', repo: 'node-private', number: 927 }
    );
  });

  it('parses a public nodejs/node PR URL', () => {
    assert.deepStrictEqual(
      parsePullRequestURL('https://github.com/nodejs/node/pull/63752'),
      { owner: 'nodejs', repo: 'node', number: 63752 }
    );
  });

  it('returns null for empty or invalid URLs', () => {
    assert.strictEqual(parsePullRequestURL(''), null);
    assert.strictEqual(parsePullRequestURL(undefined), null);
    assert.strictEqual(parsePullRequestURL('https://github.com/nodejs/node'), null);
  });
});

describe('prepare_release: getPullRequestURLForLine', () => {
  const affectedVersions = {
    main: 'https://github.com/nodejs-private/node-private/pull/924',
    '26.x': 'https://github.com/nodejs-private/node-private/pull/924',
    '24.x': 'https://github.com/nodejs-private/node-private/pull/927',
    '22.x': 'https://github.com/nodejs-private/node-private/pull/927'
  };

  it('resolves the PR URL for the requested line (object schema)', () => {
    assert.strictEqual(
      getPullRequestURLForLine(affectedVersions, '22.x'),
      'https://github.com/nodejs-private/node-private/pull/927'
    );
    assert.strictEqual(
      getPullRequestURLForLine(affectedVersions, '26.x'),
      'https://github.com/nodejs-private/node-private/pull/924'
    );
  });

  it('returns null when the line is absent or empty', () => {
    assert.strictEqual(getPullRequestURLForLine(affectedVersions, '20.x'), null);
    assert.strictEqual(getPullRequestURLForLine({ '22.x': '' }, '22.x'), null);
  });

  it('falls back to the legacy array schema paired with prURL', () => {
    const legacyPrURL = 'https://github.com/nodejs-private/node-private/pull/900';
    assert.strictEqual(
      getPullRequestURLForLine(['22.x', '24.x'], '22.x', legacyPrURL),
      legacyPrURL
    );
    assert.strictEqual(
      getPullRequestURLForLine(['24.x'], '22.x', legacyPrURL),
      null
    );
  });

  it('returns null for missing affectedVersions', () => {
    assert.strictEqual(getPullRequestURLForLine(undefined, '22.x'), null);
    assert.strictEqual(getPullRequestURLForLine(null, '22.x'), null);
  });
});

describe('prepare_release: formatSecurityNotableChanges', () => {
  it('sorts by severity then CVE-ID and formats each entry', () => {
    const severityByCVE = new Map([
      ['CVE-2026-48933', 'high'],
      ['CVE-2026-48618', 'high'],
      ['CVE-2026-48615', 'medium'],
      ['CVE-2026-48617', 'low']
    ]);
    const commits = [
      {
        subject: 'permission: handle process.chdir on writereport',
        author: 'RafaelGSS',
        cveIds: ['CVE-2026-48617']
      },
      {
        subject: 'lib,test: redact proxy credentials in tunnel errors',
        author: 'Matteo Collina',
        cveIds: ['CVE-2026-48615']
      },
      {
        subject: 'crypto: guard WebCrypto cipher output length',
        author: 'Filip Skokan',
        cveIds: ['CVE-2026-48933']
      },
      {
        subject: 'tls: normalize hostname for server identity checks',
        author: 'Matteo Collina',
        cveIds: ['CVE-2026-48618']
      }
    ];

    assert.strictEqual(
      formatSecurityNotableChanges(commits, severityByCVE),
      '* (CVE-2026-48618) tls: normalize hostname for server identity ' +
        'checks (Matteo Collina) – High\n' +
      '* (CVE-2026-48933) crypto: guard WebCrypto cipher output length ' +
        '(Filip Skokan) – High\n' +
      '* (CVE-2026-48615) lib,test: redact proxy credentials in tunnel ' +
        'errors (Matteo Collina) – Medium\n' +
      '* (CVE-2026-48617) permission: handle process.chdir on writereport ' +
        '(RafaelGSS) – Low\n'
    );
  });

  it('lists commits without a CVE or severity last, without annotations', () => {
    const severityByCVE = new Map([['CVE-2026-48618', 'HIGH']]);
    const commits = [
      { subject: 'deps: update undici to 6.21.2', author: 'Node.js GitHub Bot', cveIds: [] },
      { subject: 'tls: some fix', author: 'A Contributor', cveIds: ['CVE-2026-1'] },
      {
        subject: 'tls: normalize hostname for server identity checks',
        author: 'Matteo Collina',
        cveIds: ['CVE-2026-48618']
      }
    ];

    assert.strictEqual(
      formatSecurityNotableChanges(commits, severityByCVE),
      '* (CVE-2026-48618) tls: normalize hostname for server identity ' +
        'checks (Matteo Collina) – High\n' +
      '* (CVE-2026-1) tls: some fix (A Contributor)\n' +
      '* deps: update undici to 6.21.2 (Node.js GitHub Bot)\n'
    );
    assert.strictEqual(formatSecurityNotableChanges([], severityByCVE), '');
  });
});

describe('prepare_release: utils.getAlphaVersionComponents', () => {
  it('parses the alpha components of an Alpha version', () => {
    assert.deepStrictEqual(
      utils.getAlphaVersionComponents(semver.parse('27.0.0-alpha.0.0.0')),
      { major: 0, minor: 0, patch: 0 }
    );
    assert.deepStrictEqual(
      utils.getAlphaVersionComponents(semver.parse('v27.0.0-alpha.1.12.3')),
      { major: 1, minor: 12, patch: 3 }
    );
  });

  it('returns null for versions that are not N.0.0-alpha.X.Y.Z', () => {
    for (const version of [
      '27.0.0', '26.1.0', '27.0.0-rc.1', '27.0.0-alpha.1',
      '27.0.0-alpha.1.0', '27.0.0-alpha.1.0.0.0', '27.1.0-alpha.0.0.0',
      '27.0.1-alpha.0.0.0', '27.0.0-alpha.x.0.0'
    ]) {
      assert.strictEqual(
        utils.getAlphaVersionComponents(semver.parse(version)), null, version);
    }
  });
});

describe('prepare_release: utils.isAlphaReleaseLine', () => {
  it('detects the NODE_ALPHA_*_VERSION macros', () => {
    assert.strictEqual(utils.isAlphaReleaseLine(nodeVersionH({
      major: 27, minor: 0, patch: 0, alpha: { major: 0, minor: 0, patch: 0 }
    })), true);
    assert.strictEqual(utils.isAlphaReleaseLine(nodeVersionH({
      major: 26, minor: 12, patch: 0
    })), false);
  });
});

describe('prepare_release: utils.formatVersion', () => {
  it('formats Current and Alpha versions', () => {
    assert.strictEqual(utils.formatVersion({ major: 26, minor: 12, patch: 1 }), '26.12.1');
    assert.strictEqual(
      utils.formatVersion({ major: 27, minor: 0, patch: 0 }, { major: 1, minor: 0, patch: 2 }),
      '27.0.0-alpha.1.0.2'
    );
  });
});

describe('prepare_release: formatReleaseInfo', () => {
  it('formats the release type of Alpha, Current and LTS releases', () => {
    assert.strictEqual(formatReleaseInfo({ isAlpha: true }), '(Alpha)');
    assert.strictEqual(formatReleaseInfo({ isLTS: false }), '(Current)');
    assert.strictEqual(
      formatReleaseInfo({ isLTS: true, ltsCodename: 'Krypton' }), '\'Krypton\' (LTS)');
  });
});

describe('prepare_release: calculateNewVersion', () => {
  const cases = [
    ['* [abc] - **(SEMVER-MAJOR)** lib: change', { major: 1, minor: 0, patch: 0 }],
    ['* [abc] - **(SEMVER-MINOR)** lib: add', { major: 0, minor: 2, patch: 0 }],
    ['* [abc] - lib: fix', { major: 0, minor: 1, patch: 3 }]
  ];
  for (const [changelog, expected] of cases) {
    it(`bumps ${JSON.stringify(expected)} for ${changelog}`, async() => {
      const release = releasePreparation({ getChangelog: () => changelog });
      assert.deepStrictEqual(
        await release.calculateNewVersion({
          tagName: 'v27.0.0-alpha.0.1.2', major: 0, minor: 1, patch: 2
        }),
        expected
      );
    });
  }
});

describe('prepare_release: getLastRelease', () => {
  it('parses the latest Alpha release from the changelog', async(t) => {
    nodeCheckout(t, { 'doc/changelogs/CHANGELOG_V27.md': changelogV27 });
    const release = releasePreparation();
    assert.deepStrictEqual(await release.getLastRelease('27'), {
      tagName: 'v27.0.0-alpha.0.0.0',
      major: '27',
      minor: '0',
      patch: '0',
      alpha: { major: 0, minor: 0, patch: 0 }
    });
  });

  it('parses the latest Current release from the changelog', async(t) => {
    nodeCheckout(t, {
      'doc/changelogs/CHANGELOG_V26.md':
        '<a href="#26.12.0">26.12.0</a><br/>\n<a href="#26.11.1">26.11.1</a><br/>\n'
    });
    const release = releasePreparation();
    assert.deepStrictEqual(await release.getLastRelease('26'), {
      tagName: 'v26.12.0',
      major: '26',
      minor: '12',
      patch: '0'
    });
  });
});

describe('prepare_release: prepareLocalBranch', () => {
  const alphaLineFiles = {
    'src/node_version.h': nodeVersionH({
      major: 27, minor: 0, patch: 0, alpha: { major: 0, minor: 0, patch: 1 }
    }),
    'doc/changelogs/CHANGELOG_V27.md': changelogV27
  };

  it('calculates the next Alpha version on an Alpha release line', async(t) => {
    nodeCheckout(t, alphaLineFiles);
    const release = releasePreparation({
      getCurrentBranch: () => 'v27.x-staging',
      getChangelog: () => '* [abc] - **(SEMVER-MAJOR)** lib: change'
    });
    await release.prepareLocalBranch();
    assert.strictEqual(release.isAlpha, true);
    assert.strictEqual(release.newVersion, '27.0.0-alpha.1.0.0');
    assert.deepStrictEqual(release.versionComponents, { major: '27', minor: '0', patch: '0' });
    assert.deepStrictEqual(release.alphaVersionComponents, { major: 1, minor: 0, patch: 0 });
    assert.strictEqual(release.releaseBranch, 'v27.x');
  });

  it('accepts an Alpha --newVersion on an Alpha release line', async(t) => {
    nodeCheckout(t, alphaLineFiles);
    const release = releasePreparation({ newVersion: '27.0.0-alpha.0.1.0' });
    await release.prepareLocalBranch();
    assert.strictEqual(release.isAlpha, true);
    assert.strictEqual(release.newVersion, '27.0.0-alpha.0.1.0');
    assert.deepStrictEqual(release.versionComponents, { major: 27, minor: 0, patch: 0 });
    assert.deepStrictEqual(release.alphaVersionComponents, { major: 0, minor: 1, patch: 0 });
    assert.strictEqual(release.stagingBranch, 'v27.x-staging');
  });

  it('treats a non-Alpha --newVersion on an Alpha line as the stable release', async(t) => {
    nodeCheckout(t, alphaLineFiles);
    const release = releasePreparation({ newVersion: '27.0.0' });
    await release.prepareLocalBranch();
    assert.strictEqual(release.isAlpha, false);
    assert.strictEqual(release.newVersion, '27.0.0');
  });

  it('rejects malformed Alpha versions', async(t) => {
    nodeCheckout(t, alphaLineFiles);
    const release = releasePreparation({ newVersion: '27.0.0-alpha.1' });
    await assert.rejects(release.prepareLocalBranch(), /not a valid Alpha version/);
  });

  it('rejects Alpha versions on a release line without the alpha macros', async(t) => {
    nodeCheckout(t, {
      'src/node_version.h': nodeVersionH({ major: 26, minor: 12, patch: 1 })
    });
    const release = releasePreparation({ newVersion: '26.0.0-alpha.0.0.0' });
    await assert.rejects(release.prepareLocalBranch(), /NODE_ALPHA_\*_VERSION/);
  });
});

describe('prepare_release: updateNodeVersion', () => {
  it('sets the alpha components for an Alpha release', async(t) => {
    nodeCheckout(t, {
      'src/node_version.h': nodeVersionH({
        major: 27, minor: 0, patch: 0, alpha: { major: 0, minor: 0, patch: 1 }
      })
    });
    const release = releasePreparation({
      isAlpha: true,
      versionComponents: { major: 27, minor: 0, patch: 0 },
      alphaVersionComponents: { major: 1, minor: 0, patch: 0 }
    });
    await release.updateNodeVersion();
    assert.strictEqual(
      fs.readFileSync('src/node_version.h', 'utf8'),
      nodeVersionH({
        major: 27, minor: 0, patch: 0, isRelease: 1, alpha: { major: 1, minor: 0, patch: 0 }
      })
    );
  });

  it('removes the alpha macros when the release line goes stable', async(t) => {
    nodeCheckout(t, {
      'src/node_version.h': nodeVersionH({
        major: 27, minor: 0, patch: 0, alpha: { major: 3, minor: 1, patch: 1 }
      })
    });
    const release = releasePreparation({
      versionComponents: { major: 27, minor: 0, patch: 0 }
    });
    await release.updateNodeVersion();
    assert.strictEqual(
      fs.readFileSync('src/node_version.h', 'utf8'),
      nodeVersionH({ major: 27, minor: 0, patch: 0, isRelease: 1 })
    );
  });

  it('updates a Current release line without alpha macros', async(t) => {
    nodeCheckout(t, {
      'src/node_version.h': nodeVersionH({ major: 26, minor: 12, patch: 1 })
    });
    const release = releasePreparation({
      versionComponents: { major: 26, minor: 13, patch: 0 }
    });
    await release.updateNodeVersion();
    assert.strictEqual(
      fs.readFileSync('src/node_version.h', 'utf8'),
      nodeVersionH({ major: 26, minor: 13, patch: 0, isRelease: 1 })
    );
  });
});

describe('prepare_release: changelogs', () => {
  const alphaRelease = () => releasePreparation({
    isAlpha: true,
    date: '2026-11-10',
    newVersion: '27.0.0-alpha.1.0.0',
    versionComponents: { major: 27, minor: 0, patch: 0 },
    alphaVersionComponents: { major: 1, minor: 0, patch: 0 },
    getChangelog: () => '* \\[[`abc`](url)] - **(SEMVER-MAJOR)** lib: change',
    getBranchDiff: async() => '* lib: change\n'
  });

  it('adds an Alpha release to CHANGELOG_V27.md', async(t) => {
    nodeCheckout(t, { 'doc/changelogs/CHANGELOG_V27.md': changelogV27 });
    await alphaRelease().updateMajorChangelog();
    const changelog = fs.readFileSync('doc/changelogs/CHANGELOG_V27.md', 'utf8');
    assert.match(changelog, new RegExp([
      '<td>',
      '<a href="#27\\.0\\.0-alpha\\.1\\.0\\.0">27\\.0\\.0-alpha\\.1\\.0\\.0</a><br/>',
      '<a href="#27\\.0\\.0-alpha\\.0\\.0\\.0">27\\.0\\.0-alpha\\.0\\.0\\.0</a><br/>'
    ].join('\n')));
    assert.ok(changelog.includes([
      '<a id="27.0.0-alpha.1.0.0"></a>',
      '',
      '## 2026-11-10, Version 27.0.0-alpha.1.0.0 (Alpha), @RafaelGSS',
      '',
      '### Notable Changes',
      '',
      '* lib: change',
      '',
      '### Commits',
      '',
      '* \\[[`abc`](url)] - **(SEMVER-MAJOR)** lib: change',
      '',
      '<a id="27.0.0-alpha.0.0.0"></a>'
    ].join('\n')));
  });

  it('adds an Alpha release to CHANGELOG.md', async(t) => {
    const link = 'doc/changelogs/CHANGELOG_V27.md';
    nodeCheckout(t, {
      'CHANGELOG.md':
        `<b><a href="${link}#27.0.0-alpha.0.0.0">27.0.0-alpha.0.0.0</a></b><br/>\n`
    });
    await alphaRelease().updateMainChangelog();
    assert.strictEqual(
      fs.readFileSync('CHANGELOG.md', 'utf8'),
      `<b><a href="${link}#27.0.0-alpha.1.0.0">27.0.0-alpha.1.0.0</a></b><br/>\n` +
      `<a href="${link}#27.0.0-alpha.0.0.0">27.0.0-alpha.0.0.0</a><br/>\n`
    );
  });
});

describe('prepare_release: utils.updateNodeVersionForNextMajor', () => {
  it('moves the default branch to the next major release line', () => {
    assert.strictEqual(
      utils.updateNodeVersionForNextMajor(nodeVersionH({
        major: 27, minor: 0, patch: 0, isRelease: 1, alpha: { major: 0, minor: 0, patch: 0 }
      }), 28),
      nodeVersionH({ major: 28, minor: 0, patch: 0, alpha: { major: 0, minor: 0, patch: 0 } })
    );
  });

  it('resets the alpha macros, or adds them if missing', () => {
    const expected =
      nodeVersionH({ major: 28, minor: 0, patch: 0, alpha: { major: 0, minor: 0, patch: 0 } });
    assert.strictEqual(utils.updateNodeVersionForNextMajor(nodeVersionH({
      major: 27, minor: 0, patch: 0, alpha: { major: 3, minor: 2, patch: 1 }
    }), 28), expected);
    assert.strictEqual(utils.updateNodeVersionForNextMajor(nodeVersionH({
      major: 27, minor: 0, patch: 0, isRelease: 1
    }), 28), expected);
  });
});

describe('prepare_release: utils.incrementVersion', () => {
  it('increments Alpha and other versions', () => {
    assert.strictEqual(utils.incrementVersion('27.0.0-alpha.1.2.3', 'patch'), '27.0.0-alpha.1.2.4');
    assert.strictEqual(utils.incrementVersion('27.0.0-alpha.1.2.3', 'minor'), '27.0.0-alpha.1.3.0');
    assert.strictEqual(utils.incrementVersion('26.12.1', 'patch'), '26.12.2');
    assert.strictEqual(utils.incrementVersion('26.12.1', 'minor'), '26.13.0');
  });
});

const commitLine = (sha, title, labels = '') =>
  `* \\[[\`${sha}\`](https://github.com/nodejs/node/commit/${sha})] - ` +
  `${labels ? `**(${labels})** ` : ''}${title} (Author) [#1](https://github.com/nodejs/node/pull/1)`;

describe('prepare_release: filterAlphaReleaseCommits', () => {
  it('removes Alpha release and working on commits', () => {
    const commits = [
      commitLine('aaaaaaaaaa', 'Working on v27.0.0-alpha.0.0.1'),
      commitLine('bbbbbbbbbb', '2026-10-28, Version 27.0.0-alpha.0.0.0 (Alpha)'),
      commitLine('cccccccccc', '**doc**: fix typo')
    ].join('\n');
    assert.strictEqual(
      filterAlphaReleaseCommits(commits), commitLine('cccccccccc', '**doc**: fix typo'));
  });
});

describe('prepare_release: parseReverts', () => {
  it('parses the reverted commits from git log', () => {
    const log = 'abc1230000\x1fThis reverts commit def4560000111.\n\nPR-URL: x\x1e\n' +
      'fff0000000\x1fRefs: y\x1e\n';
    assert.deepStrictEqual(parseReverts(log), [['abc1230000', 'def4560000111']]);
  });
});

describe('prepare_release: formatMajorReleaseCommits', () => {
  it('groups the commits by semver label', () => {
    const commits = [
      commitLine('1111111111', '**lib**: add feature', 'SEMVER-MINOR'),
      commitLine('2222222222', '**lib**: break things', 'SEMVER-MAJOR'),
      commitLine('3333333333', '**doc**: fix typo'),
      ''
    ].join('\n');
    assert.strictEqual(formatMajorReleaseCommits(commits, []), [
      '### Semver-Major Commits',
      '',
      commitLine('2222222222', '**lib**: break things', 'SEMVER-MAJOR'),
      '',
      '### Semver-Minor Commits',
      '',
      commitLine('1111111111', '**lib**: add feature', 'SEMVER-MINOR'),
      '',
      '### Semver-Patch Commits',
      '',
      commitLine('3333333333', '**doc**: fix typo'),
      ''
    ].join('\n'));
  });

  it('drops reverted commits along with their reverts, keeping relands', () => {
    const commits = [
      commitLine('4444444444', '_**Revert**_ "**lib**: revert the revert"'),
      commitLine('3333333333', '_**Revert**_ "**lib**: break things"'),
      commitLine('2222222222', '**lib**: break things', 'SEMVER-MAJOR'),
      commitLine('1111111111', '_**Revert**_ "**src**: not in this release line"'),
      commitLine('5555555555', '**http**: drop me', 'SEMVER-MAJOR'),
      commitLine('6666666666', '_**Revert**_ "**http**: drop me"')
    ].join('\n');
    const reverts = [
      ['6666666666aaaa', '5555555555bbbb'],
      ['4444444444cccc', '3333333333dddd'],
      ['3333333333dddd', '2222222222eeee'],
      ['1111111111ffff', '0000000000aaaa']
    ];
    assert.strictEqual(formatMajorReleaseCommits(commits, reverts), [
      '### Semver-Major Commits',
      '',
      commitLine('2222222222', '**lib**: break things', 'SEMVER-MAJOR'),
      '',
      '### Semver-Patch Commits',
      '',
      commitLine('1111111111', '_**Revert**_ "**src**: not in this release line"'),
      ''
    ].join('\n'));
  });
});

describe('prepare_release: first release of a release line', () => {
  const firstAlphaFiles = {
    'src/node_version.h': nodeVersionH({
      major: 27, minor: 0, patch: 0, alpha: { major: 0, minor: 0, patch: 0 }
    })
  };

  it('calculates the first Alpha version without a changelog', async(t) => {
    nodeCheckout(t, firstAlphaFiles);
    const release = releasePreparation({
      getCurrentBranch: () => 'v27.x-staging',
      getLastRelease() { throw new Error('No release to compare with'); }
    });
    await release.prepareLocalBranch();
    assert.strictEqual(release.isFirstRelease, true);
    assert.strictEqual(release.isAlpha, true);
    assert.strictEqual(release.newVersion, '27.0.0-alpha.0.0.0');
    assert.deepStrictEqual(release.versionComponents, { major: 27, minor: 0, patch: 0 });
    assert.deepStrictEqual(release.alphaVersionComponents, { major: 0, minor: 0, patch: 0 });
  });

  it('accepts the first Alpha version as --newVersion', async(t) => {
    nodeCheckout(t, firstAlphaFiles);
    const release = releasePreparation({
      newVersion: '27.0.0-alpha.0.0.0',
      getLastRelease() { throw new Error('No release to compare with'); }
    });
    await release.prepareLocalBranch();
    assert.strictEqual(release.isFirstRelease, true);
    assert.strictEqual(release.newVersion, '27.0.0-alpha.0.0.0');
  });

  const otherVersions = [
    '* Other Versions',
    '  * [25.x](CHANGELOG_V25.md)',
    '  * [Archive](CHANGELOG_ARCHIVE.md)',
    ''
  ].join('\n');

  it('creates CHANGELOG_V27.md and links it from the other changelogs', async(t) => {
    nodeCheckout(t, {
      'doc/changelogs/CHANGELOG_V26.md': `# Node.js 26 ChangeLog\n\n${otherVersions}\n`,
      'doc/changelogs/CHANGELOG_ARCHIVE.md': `# Archive\n\n${otherVersions}`
    });
    const majorCommits =
      '### Semver-Major Commits\n\n* major\n\n### Semver-Patch Commits\n\n* patch\n';
    const release = releasePreparation({
      isAlpha: true,
      isFirstRelease: true,
      date: '2026-10-28',
      newVersion: '27.0.0-alpha.0.0.0',
      versionComponents: { major: 27, minor: 0, patch: 0 },
      getBranchDiff: async() => '* major\n',
      getMajorReleaseCommits: async() => majorCommits,
      getLastRef() { throw new Error('No release to compare with'); }
    });
    await release.updateMajorChangelog();
    assert.strictEqual(fs.readFileSync('doc/changelogs/CHANGELOG_V27.md', 'utf8'), [
      '# Node.js 27 ChangeLog',
      '',
      '<!--lint disable maximum-line-length no-literal-urls prohibited-strings-->',
      '',
      '<table>',
      '<tr>',
      '<th>Alpha</th>',
      '</tr>',
      '<tr>',
      '<td>',
      '<a href="#27.0.0-alpha.0.0.0">27.0.0-alpha.0.0.0</a><br/>',
      '</td>',
      '</tr>',
      '</table>',
      '',
      '* Other Versions',
      '  * [26.x](CHANGELOG_V26.md)',
      '  * [25.x](CHANGELOG_V25.md)',
      '  * [Archive](CHANGELOG_ARCHIVE.md)',
      '',
      '<a id="27.0.0-alpha.0.0.0"></a>',
      '',
      '## 2026-10-28, Version 27.0.0-alpha.0.0.0 (Alpha), @RafaelGSS',
      '',
      '### Notable Changes',
      '',
      '* major',
      '',
      '### Semver-Major Commits',
      '',
      '* major',
      '',
      '### Semver-Patch Commits',
      '',
      '* patch',
      ''
    ].join('\n'));
    for (const file of ['CHANGELOG_V26.md', 'CHANGELOG_ARCHIVE.md']) {
      assert.match(
        fs.readFileSync(`doc/changelogs/${file}`, 'utf8'),
        /\n\* Other Versions\n {2}\* \[27\.x\]\(CHANGELOG_V27\.md\)\n {2}\* \[25\.x\]/
      );
    }
  });

  it('adds the release line to CHANGELOG.md', async(t) => {
    const link = 'doc/changelogs/CHANGELOG_V26.md';
    nodeCheckout(t, {
      'CHANGELOG.md': [
        '# Node.js Changelog',
        '',
        `* [Node.js 26](${link}) **Current**`,
        '',
        '<table>',
        '<tr>',
        `  <th title="Current"><a href="${link}">26</a> (Current)</th>`,
        '</tr>',
        '<tr>',
        '  <td valign="top">',
        `<b><a href="${link}#26.12.0">26.12.0</a></b><br/>`,
        '  </td>',
        ''
      ].join('\n')
    });
    const release = releasePreparation({
      isAlpha: true,
      isFirstRelease: true,
      newVersion: '27.0.0-alpha.0.0.0',
      versionComponents: { major: 27, minor: 0, patch: 0 },
      getLastRef() { throw new Error('No release to compare with'); }
    });
    await release.updateMainChangelog();
    const newLink = 'doc/changelogs/CHANGELOG_V27.md';
    assert.strictEqual(fs.readFileSync('CHANGELOG.md', 'utf8'), [
      '# Node.js Changelog',
      '',
      `* [Node.js 27](${newLink}) **Alpha**`,
      `* [Node.js 26](${link}) **Current**`,
      '',
      '<table>',
      '<tr>',
      `  <th title="Alpha"><a href="${newLink}">27</a> (Alpha)</th>`,
      `  <th title="Current"><a href="${link}">26</a> (Current)</th>`,
      '</tr>',
      '<tr>',
      '  <td valign="top">',
      `<b><a href="${newLink}#27.0.0-alpha.0.0.0">27.0.0-alpha.0.0.0</a></b><br/>`,
      '  </td>',
      '  <td valign="top">',
      `<b><a href="${link}#26.12.0">26.12.0</a></b><br/>`,
      '  </td>',
      ''
    ].join('\n'));
  });
});

describe('prepare_release: release line out of Alpha', () => {
  const alphaLineFiles = {
    'src/node_version.h': nodeVersionH({
      major: 27, minor: 0, patch: 0, alpha: { major: 2, minor: 0, patch: 1 }
    }),
    'doc/changelogs/CHANGELOG_V27.md': changelogV27
  };

  it('rejects --startLTS on an Alpha release line', async(t) => {
    nodeCheckout(t, alphaLineFiles);
    for (const props of [
      { getCurrentBranch: () => 'v27.x-staging' },
      { newVersion: '27.0.0' },
      { newVersion: '27.0.0-alpha.3.0.0' }
    ]) {
      const release = releasePreparation({ isLTSTransition: true, ...props });
      await assert.rejects(release.prepareLocalBranch(), /Cannot use --startLTS on an Alpha/);
    }
  });

  it('marks a non-Alpha version on an Alpha line as out of Alpha', async(t) => {
    nodeCheckout(t, alphaLineFiles);
    const release = releasePreparation({ newVersion: '27.0.0' });
    await release.prepareLocalBranch();
    assert.strictEqual(release.isOutOfAlpha, true);
    assert.strictEqual(release.isFirstRelease, false);
  });

  const outOfAlpha = () => releasePreparation({
    isOutOfAlpha: true,
    date: '2027-04-20',
    newVersion: '27.0.0',
    versionComponents: { major: 27, minor: 0, patch: 0 },
    getChangelog: () => '',
    getBranchDiff: async() => ''
  });

  it('relabels CHANGELOG_V27.md as Current', async(t) => {
    nodeCheckout(t, { 'doc/changelogs/CHANGELOG_V27.md': changelogV27 });
    await outOfAlpha().updateMajorChangelog();
    const changelog = fs.readFileSync('doc/changelogs/CHANGELOG_V27.md', 'utf8');
    assert.ok(changelog.includes('<th>Current</th>'));
    assert.ok(!changelog.includes('<th>Alpha</th>'));
    assert.ok(changelog.includes('## 2027-04-20, Version 27.0.0 (Current), @RafaelGSS'));
  });

  it('relabels the release line as Current in CHANGELOG.md', async(t) => {
    const link = 'doc/changelogs/CHANGELOG_V27.md';
    nodeCheckout(t, {
      'CHANGELOG.md': [
        `* [Node.js 27](${link}) **Alpha**`,
        `  <th title="Alpha"><a href="${link}">27</a> (Alpha)</th>`,
        `<b><a href="${link}#27.0.0-alpha.0.0.0">27.0.0-alpha.0.0.0</a></b><br/>`,
        ''
      ].join('\n')
    });
    await outOfAlpha().updateMainChangelog();
    assert.strictEqual(fs.readFileSync('CHANGELOG.md', 'utf8'), [
      `* [Node.js 27](${link}) **Current**`,
      `  <th title="Current"><a href="${link}">27</a> (Current)</th>`,
      `<b><a href="${link}#27.0.0">27.0.0</a></b><br/>`,
      `<a href="${link}#27.0.0-alpha.0.0.0">27.0.0-alpha.0.0.0</a><br/>`,
      ''
    ].join('\n'));
  });
});
