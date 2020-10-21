'use strict';

const assert = require('assert');
const { readFileSync } = require('fs');
const utils = require('../../lib/release/utils');

describe('prepare_release: utils.getStartLTSBlurb', () => {
  it('generates first LTS release text with correct dates', () => {
    const expected = [
      /* eslint-disable max-len */
      'This release marks the transition of Node.js 14.x into Long Term Support (LTS)',
      'with the codename \'Fermium\'. The 14.x release line now moves into "Active LTS"',
      'and will remain so until October 2021. After that time, it will move into',
      '"Maintenance" until end of life in April 2023.'
      /* eslint-enable max-len */
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
  it('inserts test a for a new LTS codename', () => {
    const expected = readFileSync(
      `${__dirname}/../fixtures/release/expected-test-process-release.js`,
      { encoding: 'utf8' }
    );
    const test = readFileSync(
      `${__dirname}/../fixtures/release/original-test-process-release.js`,
      { encoding: 'utf8' }
    );
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
