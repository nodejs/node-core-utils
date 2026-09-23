import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildIncludedTriagedReport,
  getMissingReportInformation,
  listSecurityReleaseCandidates,
  prepareSecurityRelease
} from '../../lib/security-release/preparation.js';
import PrepareSecurityRelease from '../../lib/prepare_security.js';

function h1Report(id = '123') {
  return {
    id,
    attributes: { title: 'Example report', cve_ids: [] },
    relationships: { custom_field_values: { data: [] } }
  };
}

function report(id = '123') {
  return buildIncludedTriagedReport(h1Report(id));
}

describe('security release preparation', () => {
  it('lists candidates through the supplied read-only request', async() => {
    const reports = [h1Report('1'), h1Report('2')];
    const request = {
      async getTriagedReports() {
        return { data: reports };
      }
    };
    assert.deepStrictEqual(await listSecurityReleaseCandidates(request), reports);
  });

  it('propagates retrieval failures', async() => {
    const request = {
      async getTriagedReports() {
        throw new Error('Second page unavailable');
      }
    };
    await assert.rejects(listSecurityReleaseCandidates(request), /Second page unavailable/);
  });

  it('uses the supplied candidate snapshot for exclusions and selection', async() => {
    const candidates = [h1Report('1'), h1Report('2')];
    const messages = [];
    const cli = {
      info() {},
      separator() {},
      promptCheckbox(message, choices) {
        assert.deepStrictEqual(choices.map(({ value }) => value), ['1', '2']);
        return ['2'];
      },
      prompt(message) {
        messages.push(message);
        return false;
      }
    };
    const release = new PrepareSecurityRelease(cli);
    release.req = {
      getTriagedReports() {
        assert.fail('Do not fetch a different candidate snapshot');
      }
    };
    const excluded = await release.showTriagedReportsWithoutPR(candidates);
    assert.deepStrictEqual(await release.chooseReports(excluded, candidates), []);
    assert.strictEqual(messages.length, 1);
  });

  it('prepares only the selected reports without mutating input', () => {
    const selected = report('2');
    selected.affectedVersions = ['v24.x', '22.x', '24.x'];
    selected.prURL = 'https://github.com/nodejs-private/node-private/pull/12';
    const input = { releaseDate: '2026/10/06', reports: [selected] };
    const before = structuredClone(input);
    const { release, missingInformation } = prepareSecurityRelease(input);

    assert.strictEqual(release.releaseDate, '2026-10-06');
    assert.deepStrictEqual(release.reports.map(({ id }) => id), ['2']);
    assert.deepStrictEqual(release.reports[0].affectedVersions, { '24.x': '', '22.x': '' });
    assert.strictEqual(missingInformation[0].id, '2');
    assert.ok(missingInformation[0].missing.includes('team summary'));
    release.reports[0].cveIds.push('CVE-2026-0001');
    release.reports[0].severity.rating = 'high';
    assert.deepStrictEqual(input, before);
  });

  it('preserves explicit per-line patches and supports main', () => {
    const selected = report();
    selected.affectedVersions = {
      main: 'https://github.com/nodejs-private/node-private/pull/1',
      'v24.x': 'https://github.com/nodejs-private/node-private/pull/2',
      '22.x': ''
    };
    const { release } = prepareSecurityRelease({ releaseDate: 'TBD', reports: [selected] });
    assert.strictEqual(release.releaseDate, 'TBD');
    assert.deepStrictEqual(release.reports[0].affectedVersions, {
      main: selected.affectedVersions.main,
      '24.x': selected.affectedVersions['v24.x'],
      '22.x': ''
    });
    assert.ok(!getMissingReportInformation(release.reports[0]).includes('affected versions'));
  });

  it('keeps unknown affected versions explicit', () => {
    const { release, missingInformation } = prepareSecurityRelease({
      releaseDate: 'TBD', reports: [report()]
    });
    assert.deepStrictEqual(release.reports[0].affectedVersions, {});
    assert.ok(missingInformation[0].missing.includes('affected versions'));
  });

  it('prepares dependency-only releases and preserves legacy PR associations', () => {
    const prURL = 'https://github.com/nodejs/node/pull/1';
    const dependencies = {
      undici: [{ title: 'Update undici', prURL, affectedVersions: ['v24.x', '22.x'] }],
      openssl: { affectedVersions: { '24.x': prURL, '22.x': '' } }
    };
    const input = { releaseDate: '2026-10-06', reports: [], dependencies };
    const { release, missingInformation } = prepareSecurityRelease(input);
    assert.deepStrictEqual(release.reports, []);
    assert.deepStrictEqual(missingInformation, []);
    assert.deepStrictEqual(release.dependencies.undici[0].affectedVersions, {
      '24.x': prURL, '22.x': prURL
    });
    assert.deepStrictEqual(release.dependencies.openssl.affectedVersions, {
      '24.x': prURL, '22.x': ''
    });
    release.dependencies.undici[0].title = 'Changed';
    assert.strictEqual(dependencies.undici[0].title, 'Update undici');
  });

  it('rejects duplicate reports and invalid draft inputs', () => {
    assert.throws(() => prepareSecurityRelease({
      releaseDate: 'TBD', reports: [report('1'), report('1')]
    }), /Duplicate report ID/);
    assert.throws(() => prepareSecurityRelease({
      releaseDate: 'TBD', reports: [{ id: 'not-an-id' }]
    }), /Report ID/);
    assert.throws(() => prepareSecurityRelease({ releaseDate: 'TBD', reports: null }), /Reports/);
    assert.throws(() => prepareSecurityRelease({
      releaseDate: 'TBD', reports: [], dependencies: []
    }), /Dependencies/);
  });

  it('rejects invalid dates instead of silently rolling them forward', () => {
    for (const releaseDate of ['', undefined, 'soon', '2026-02-30', '2026-13-01', '2026/10-06']) {
      assert.throws(() => prepareSecurityRelease({ releaseDate, reports: [] }), /[Rr]elease date/);
    }
  });

  it('rejects invalid release lines and conflicting normalized mappings', () => {
    for (const affectedVersions of [
      ['invalid'], [24], 24, { '24.x': null },
      { '24.x': 'one', 'v24.x': 'two' }
    ]) {
      const selected = { ...report(), affectedVersions };
      assert.throws(() => prepareSecurityRelease({
        releaseDate: 'TBD', reports: [selected]
      }), /release line|Release line|Affected versions|PR URL/);
    }
  });
});
