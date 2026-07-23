import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import * as utils from '../../lib/release/utils.js';
import {
  parsePullRequestURL,
  getPullRequestURLForLine
} from '../../lib/prepare_release.js';

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
