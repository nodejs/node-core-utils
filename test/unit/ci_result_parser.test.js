import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  CITGMComparisonBuild
} from '../../lib/ci/build-types/citgm_comparison_build.js';
import { PRBuild } from '../../lib/ci/build-types/pr_build.js';
import { CommitBuild } from '../../lib/ci/build-types/commit_build.js';
import { BenchmarkRun } from '../../lib/ci/build-types/benchmark_run.js';
import { CITGMBuild } from '../../lib/ci/build-types/citgm_build.js';
import { jobCache } from '../../lib/ci/build-types/job.js';

import TestCLI from '../fixtures/test_cli.js';
import { tmpdir, copyShallow } from '../common.js';
import * as fixtures from '../fixtures/index.js';

function getFixturesDir(prefix) {
  const base = fileURLToPath(new URL('../fixtures', import.meta.url));
  return path.join(base, ...prefix);
}

describe('Jenkins', () => {
  it('should get failures in PR build and commit build', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'js-flake-1'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();
    const request = {
      // any attempt to call method on this would throw
    };
    const prBuild = new PRBuild(cli, request, 15363);
    await prBuild.getResults();
    const commitBuild = new CommitBuild(cli, request, 19123);
    await commitBuild.getResults();

    assert.deepStrictEqual(prBuild.commitBuild.failures, commitBuild.failures);
    const expectedPrJson = fixtures.readJSON(
      ...prefix, 'expected-pr.json'
    );
    assert.deepStrictEqual(prBuild.formatAsJson(), expectedPrJson);

    const expectedCommitJson = fixtures.readJSON(
      ...prefix, 'expected-commit.json'
    );
    assert.deepStrictEqual(
      prBuild.commitBuild.formatAsJson(),
      expectedCommitJson
    );

    assert.deepStrictEqual(prBuild.commitBuild.failures, commitBuild.failures);
    const expectedPrMd = fixtures.readFile(
      ...prefix, 'expected-pr.md'
    );
    assert.deepStrictEqual(prBuild.formatAsMarkdown(), expectedPrMd);
    const expectedCommitMd = fixtures.readFile(
      ...prefix, 'expected-commit.md'
    );
    assert.deepStrictEqual(
      prBuild.commitBuild.formatAsMarkdown(),
      expectedCommitMd
    );
  });

  it('should get successful PR build and commit build', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'success'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();
    const request = {
      // any attempt to call method on this would throw
    };
    const prBuild = new PRBuild(cli, request, 15237);
    await prBuild.getResults();
    const commitBuild = new CommitBuild(cli, request, 18960);
    await commitBuild.getResults();

    assert.deepStrictEqual(prBuild.commitBuild.failures, commitBuild.failures);

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(prBuild.commitBuild.failures, expectedJson);

    const markdown = commitBuild.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);
  });

  it('should handle node-test-commit trigger failure', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'trigger-failure'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();
    const request = {
      // any attempt to call method on this would throw
    };
    const prBuild = new PRBuild(cli, request, 15442);
    await prBuild.getResults();

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(prBuild.formatAsJson(), expectedJson);

    const markdown = prBuild.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);
  });

  it('should handle git failure', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'git-failure-1'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();
    const request = {
      // any attempt to call method on this would throw
    };
    const prBuild = new PRBuild(cli, request, 15449);
    await prBuild.getResults();

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(prBuild.formatAsJson(), expectedJson);

    const markdown = prBuild.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);
  });

  it('should handle no compiler failure', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'no-compiler-error'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();
    const request = {
      // any attempt to call method on this would throw
    };
    const prBuild = new PRBuild(cli, request, 15470);
    await prBuild.getResults();

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(prBuild.formatAsJson(), expectedJson);

    const markdown = prBuild.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);
  });

  it('should get benchmark run', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'benchmark-buffer'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();
    const request = {
      // any attempt to call method on this would throw
    };
    const run = new BenchmarkRun(cli, request, 150);
    await run.getResults();

    const markdown = run.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(run.formatAsJson(), expectedJson);
  });

  it('should correctly fetch CITGM build results', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'citgm'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();
    const job = { jobid: 2400, noBuild: false };
    const citgmBuild = new CITGMBuild(cli, {}, job);
    await citgmBuild.getResults();

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(citgmBuild.formatAsJson(), expectedJson);

    const markdown = citgmBuild.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);
  });

  it('should correctly fetch CITGM nobuild job results', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'citgm-nobuild'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();
    const job = { jobid: 866, noBuild: true };
    const citgmBuild = new CITGMBuild(cli, {}, job);
    await citgmBuild.getResults();

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(citgmBuild.formatAsJson(), expectedJson);

    const markdown = citgmBuild.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);
  });

  it('should correctly fetch CITGM comparison build results', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'citgm-compare'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();

    const job = {
      jobid: 2392,
      jobid2: 2390,
      noBuild: false
    };

    const comparisonBuild = new CITGMComparisonBuild(cli, {}, job);
    await comparisonBuild.getResults();

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(comparisonBuild.formatAsJson(), expectedJson);

    const markdown = comparisonBuild.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);
  });

  it('should correctly fetch CITGM comparison noBuild results', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'citgm-compare-nobuild'];
    const fixturesDir = getFixturesDir(prefix);
    copyShallow(fixturesDir, tmpdir.path);
    jobCache.dir = tmpdir.path;
    jobCache.enable();

    const cli = new TestCLI();

    const job = {
      jobid: 880,
      jobid2: 2433,
      noBuild: true
    };

    const comparisonBuild = new CITGMComparisonBuild(cli, {}, job);
    await comparisonBuild.getResults();

    const expectedJson = fixtures.readJSON(...prefix, 'expected.json');
    assert.deepStrictEqual(comparisonBuild.formatAsJson(), expectedJson);

    const markdown = comparisonBuild.formatAsMarkdown();
    const expected = fixtures.readFile(...prefix, 'expected.md');
    assert.strictEqual(markdown, expected);
  });
});
