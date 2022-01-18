import { statusType } from '../ci_utils.js';
import { CITGMBuild } from './citgm_build.js';

export class CITGMComparisonBuild {
  constructor(cli, request, job) {
    const { jobid, jobid2, noBuild } = job;

    const baseBuild = new CITGMBuild(cli, request, { jobid, noBuild });

    // noBuild in a comparison build only applies to the base build.
    const comparisonBuild = new CITGMBuild(cli, request, {
      jobid: jobid2,
      noBuild: false
    });

    this.cli = cli;
    this.builds = { baseBuild, comparisonBuild };
    this.results = {};
    this.failures = { baseBuild: [], comparisonBuild: [] };
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

    if (baseBuild.failures.length || comparisonBuild.failures.length) {
      this.failures.baseBuild =
        this.failures.baseBuild.concat(baseBuild.failures);
      this.failures.comparisonBuild =
        this.failures.comparisonBuild.concat(comparisonBuild.failures);
      return;
    }

    const { failures: baseFailures } = baseBuild.results;
    const { failures: comparisonFailures } = comparisonBuild.results;

    const failures = {};
    for (const platform in comparisonFailures) {
      // Account for no failure on this platform, or different platform.
      if (!Object.prototype.hasOwnProperty.call(baseFailures, platform)) {
        failures[platform] = [];
        continue;
      }

      const baseModules = baseFailures[platform].modules.map(f => {
        return f.name;
      });
      const comparisonModules = comparisonFailures[platform].modules.map(f => {
        return f.name;
      });

      // Filter for every failed module in the comparison job module set
      // that is not present in the failure set for the base job module set.
      const newFailures = comparisonModules.filter(f => {
        return !baseModules.includes(f);
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
    const { builds, failures } = this;

    if (failures.baseBuild.length || failures.comparisonBuild.length) {
      for (const failure of failures.baseBuild) {
        builds.baseBuild.displayFailure(failure);
      }
      for (const failure of failures.comparisonBuild) {
        builds.comparisonBuild.displayFailure(failure);
      }
      return;
    }

    // Display header for both CITGM runs.
    builds.baseBuild.displayHeader();
    builds.comparisonBuild.displayHeader();

    this.displayBuilds();
  }

  displayBuilds() {
    const { builds, cli, results, result } = this;

    const bID = builds.baseBuild.id;
    const cID = builds.comparisonBuild.id;

    cli.separator('Results');

    if (result === statusType.SUCCESS) {
      cli.log('\n\n');
      const str = `No new failures in ${cID} compared to ${bID}`;
      cli.log(`${statusType.SUCCESS}: ${str}\n\n`);
      return;
    }

    const output = {};
    let totalFailures = 0;
    for (const platform in results.failures) {
      const failures = results.failures[platform];
      totalFailures += failures.length;

      output[platform] = failures;
    }

    cli.log('\n\n');
    const str = `${totalFailures} failures in ${cID} not present in ${bID}`;
    cli.log(`${statusType.FAILURE}: ${str}\n\n`);
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

      const failures = data.map(f => `* ${f}`);
      output += failures.length ? `${failures.join('\n')}\n\n` : 'None.\n\n';
    }
    return output;
  }
}
