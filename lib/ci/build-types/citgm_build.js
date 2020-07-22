'use strict';

const { TestBuild } = require('./test_build');
const { flatten } = require('../../utils');
const { getNodeName, pad } = require('../ci_utils');

const {
  CITGM_MAIN_TREE,
  CITGM_REPORT_TREE
} = require('../jenkins_constants');
const {
  FAILURE_TYPES: { NCU_FAILURE },
  FAILURE_CONSTRUCTORS: {
    [NCU_FAILURE]: NCUFailure
  }
} = require('../ci_failure_parser');

class CITGMBuild extends TestBuild {
  constructor(cli, request, job) {
    const { jobid, noBuild } = job;
    const path = noBuild
      ? `job/citgm-smoker-nobuild/${jobid}/`
      : `job/citgm-smoker/${jobid}/`;

    const tree = CITGM_MAIN_TREE;

    super(cli, request, path, tree);

    this.id = jobid;
    this.noBuild = noBuild;
  }

  async getResults() {
    const { apiUrl } = this;

    let headerData;
    try {
      headerData = await this.getBuildData('Summary');
    } catch (err) {
      this.failures = [
        new NCUFailure({ url: this.apiUrl }, err.message)
      ];
      return this.failures;
    }
    const { result } = headerData;

    this.setBuildData(headerData);

    // CITGM jobs store results in a different location than
    // they do summary data, so we need to update the endpoint
    // and issue a second API call in order to fetch result data.
    this.tree = CITGM_REPORT_TREE;
    this.updatePath(true);
    let resultData;
    try {
      resultData = await this.getBuildData('Results');
    } catch (err) {
      this.failures = [
        new NCUFailure({ url: apiUrl }, err.message)
      ];
      return this.failures;
    }

    this.results = this.parseResults(resultData);

    // Update id again so that it correctly displays in Summary output.
    this.updatePath(false);

    return { result };
  }

  parseResults(data) {
    const { childReports, totalCount, skipCount, failCount } = data;
    const results = { all: {}, failures: {}, statistics: {} };
    const failureStatuses = ['FAILED', 'REGRESSION'];

    const passCount = totalCount - failCount - skipCount;
    results.statistics.passed = passCount;
    results.statistics.total = totalCount;
    results.statistics.skipped = skipCount;
    results.statistics.failed = failCount;

    childReports.forEach(platform => {
      const cases = flatten(platform.result.suites[0].cases);
      const url = platform.child.url;
      const nodeName = getNodeName(url);

      results.all[nodeName] = { url, modules: cases };

      const failedModules = cases.filter(c => {
        return failureStatuses.includes(c.status);
      });

      results.failures[nodeName] = { url, modules: failedModules };
    });

    return results;
  }

  updatePath(testReport) {
    const { id, noBuild } = this;
    if (testReport) {
      this.path = noBuild
        ? `job/citgm-smoker-nobuild/${id}/testReport/`
        : `job/citgm-smoker/${id}/testReport/`;
    } else {
      this.path = noBuild
        ? `job/citgm-smoker-nobuild/${id}/`
        : `job/citgm-smoker/${id}/`;
    }
  }

  displayBuilds() {
    const { cli, results } = this;
    const { failed, skipped, passed, total } = results.statistics;

    cli.separator('Statistics');
    console.table({
      Failed: failed,
      Skipped: skipped,
      Passed: passed,
      Total: total
    });

    cli.separator('Failures');
    const output = {};
    for (const platform in results.failures) {
      const modules = results.failures[platform].modules;
      const failures = modules.map(f => f.name);

      output[platform] = failures;
    }

    console.table(output);
  }

  formatAsJson() {
    const { jobUrl, results, sourceURL } = this;

    const result = {
      source: sourceURL,
      upstream: jobUrl,
      ...results.statistics,
      ...results.failures
    };

    return JSON.parse(JSON.stringify(result));
  }

  formatAsMarkdown() {
    const { jobUrl, result, results, id } = this;

    let output = `# CITGM Data for [${id}](${jobUrl})\n\n`;

    const { failed, skipped, passed, total } = results.statistics;

    output += `## Statistics for job [${id}](${jobUrl})\n\n`;
    output += '|  FAILED  |  SKIPPED  |  PASSED  |  TOTAL  |\n';
    output += '| -------- | --------- | -------- | ------- |\n';
    output += `| ${pad(failed, 8)} | ${pad(skipped, 9)} |`;
    output += ` ${pad(passed, 8)} | ${pad(total, 7)} |\n\n`;

    if (result === 'success') {
      output += `Job [${id}](${jobUrl}) is green.`;
      return output;
    }

    output += `## Failures in job [${id}](${jobUrl})\n\n`;
    for (const failure in results.failures) {
      const data = results.failures[failure];
      output += `### [${failure}](${data.url})\n\n`;

      const failures = data.modules.map(f => `* ${f.name}`);
      const items = failures.length > 0 ? `${failures.join('\n')}` : 'None.';
      output += `${items}\n\n`;
    }

    return output;
  }
}

module.exports = { CITGMBuild };
