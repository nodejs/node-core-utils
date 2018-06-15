'use strict';

const {
  JobParser, PRBuild, BenchmarkRun, CommitBuild, jobCache
} = require('../../lib/ci');

const TestCLI = require('../fixtures/test_cli');
const { tmpdir, copyShallow } = require('../common');
const path = require('path');
const fixtures = require('../fixtures');

const assert = require('assert');
const {
  commentsWithCI
} = require('../fixtures/data');

const expected = new Map([
  ['PR', {
    link: 'https://ci.nodejs.org/job/node-test-pull-request/10984/',
    date: '2017-10-27T04:16:36.458Z',
    jobid: 10984
  }],
  ['CITGM', {
    link: 'https://ci.nodejs.org/job/citgm-smoker/1030/',
    date: '2017-10-27T04:16:36.458Z',
    jobid: 1030
  }],
  ['LIBUV', {
    link: 'https://ci.nodejs.org/job/libuv-test-commit/537/',
    date: '2017-10-24T04:16:36.458Z',
    jobid: 537
  }],
  ['NOINTL', {
    link: 'https://ci.nodejs.org/job/node-test-commit-nointl/7/',
    date: '2017-10-23T04:16:36.458Z',
    jobid: 7
  }],
  ['V8', {
    link: 'https://ci.nodejs.org/job/node-test-commit-v8-linux/1018/',
    date: '2017-10-22T04:16:36.458Z',
    jobid: 1018
  }],
  ['BENCHMARK', {
    link: 'https://ci.nodejs.org/job/benchmark-node-micro-benchmarks/20/',
    date: '2017-10-21T04:16:36.458Z',
    jobid: 20
  }],
  ['LINTER', {
    link: 'https://ci.nodejs.org/job/node-test-linter/13127/',
    date: '2017-10-22T04:16:36.458Z',
    jobid: 13127
  }],
  ['LITE_COMMIT', {
    link: 'https://ci.nodejs.org/job/node-test-commit-lite/246/',
    date: '2018-02-09T21:38:30Z',
    jobid: 246
  }]
]);

describe('JobParser', () => {
  it('should parse CI results', () => {
    const results = new JobParser(commentsWithCI).parse();
    assert.deepStrictEqual([...expected.entries()], [...results.entries()]);
  });
});

describe('Jenkins', () => {
  it('should get failures in PR build and commit build', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'js-flake-1'];
    const fixturesDir = path.join(__dirname, '..', 'fixtures', ...prefix);
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
    const fixturesDir = path.join(__dirname, '..', 'fixtures', ...prefix);
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
    const fixturesDir = path.join(__dirname, '..', 'fixtures', ...prefix);
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

  it('should handle jenkins failure', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'jenkins-failure-1'];
    const fixturesDir = path.join(__dirname, '..', 'fixtures', ...prefix);
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

  it('should get benchmark run', async() => {
    tmpdir.refresh();
    const prefix = ['jenkins', 'benchmark-buffer'];
    const fixturesDir = path.join(__dirname, '..', 'fixtures', ...prefix);
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
});
