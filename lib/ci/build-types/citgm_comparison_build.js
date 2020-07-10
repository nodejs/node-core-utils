'use strict';

const { statusType } = require('../ci_utils');
const { CITGMBuild } = require('./citgm_build');

class CITGMComparisonBuild {
  constructor(cli, request, ids) {
    const baseBuild = new CITGMBuild(cli, request, ids[0]);
    const comparisonBuild = new CITGMBuild(cli, request, ids[1]);

    this.cli = cli;
    this.builds = { baseBuild, comparisonBuild };
    this.results = {};
    this.ids = ids;
  }

  async getResults() {
    const { builds } = this;
    const { baseBuild, comparisonBuild } = builds;

    // Result in a comparison context reflects
    // whether or not there were failures in
    // comparisonBuild not present in baseBuild,
    // e.g if there were new failures.
    let result = statusType.SUCCESS;

    await baseBuild.getResults();
    await comparisonBuild.getResults();

    const { failures: baseFailures } = baseBuild.results;
    const { failures: comparisonFailures } = comparisonBuild.results;

    const failures = {};
    for (const platform in baseFailures) {
      const { modules: baseModules } = comparisonFailures[platform];
      const { modules: comparisonModules } = comparisonFailures[platform];

      const newFailures = comparisonModules.filter(f => {
        return !baseModules.includes(f.name);
      });

      if (newFailures.length !== 0) {
        result = statusType.FAILURE;
      }

      failures[platform] = newFailures;
    }

    this.results.failures = failures;
    this.result = result;

    return result;
  }

  display() {
    const { builds } = this;

    // Display header for both CITGM runs.
    builds.baseBuild.displayHeader();
    builds.comparisonBuild.displayHeader();

    this.displayBuilds();
  }

  displayBuilds() {
    const { builds, cli, results, result } = this;

    const baseID = builds.baseBuild.id;
    const comparisonID = builds.comparisonBuild.id;

    cli.separator('Results');

    if (result === statusType.SUCCESS) {
      cli.log('\n\n');
      const str = `No new failures in ${baseID} compared to ${comparisonID}`;
      cli.log(`${statusType.SUCCESS}: ${str}\n\n`);
      return;
    }

    const output = {};
    for (const platform in results.failures) {
      const modules = results.failures[platform];
      const failures = modules.map(f => f.name);

      output[platform] = failures;
    }

    console.table(output);
  }

  formatAsJson() {
    const { builds, results } = this;
    const { baseBuild, comparisonBuild } = builds;

    const result = {
      baseBuild: {
        source: baseBuild.sourceURL,
        upstream: comparisonBuild.jobUrl
      },
      comparisonBuild: {
        source: comparisonBuild.sourceURL,
        upstream: baseBuild.jobUrl
      },
      ...results.failures
    };

    return JSON.parse(JSON.stringify(result));
  }

  formatAsMarkdown() {
    const { builds, result, results } = this;
    const { baseBuild, comparisonBuild } = builds;

    const bLink = `[#${baseBuild.id}](${baseBuild.jobUrl})`;
    const cLink = `[#${comparisonBuild.id}](${comparisonBuild.jobUrl})`;

    let output = `# CITGM Data for ${bLink} - ${cLink}\n\n`;

    if (result === 'success') {
      const bID = baseBuild.id;
      const cID = comparisonBuild.id;
      output += `No new failures in ${cID} compared to ${bID}`;
      return output;
    }

    output += `## New Failures in job ${cLink}\n\n`;
    for (const failure in results.failures) {
      const data = results.failures[failure];
      output += `### ${failure}\n\n`;

      const failures = data.map(f => `* ${f.name}`);
      output += failures.length ? `${failures.join('\n')}\n\n` : 'None.\n\n';
    }
    return output;
  }
}

module.exports = { CITGMComparisonBuild };
