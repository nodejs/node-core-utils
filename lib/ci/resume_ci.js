import { JobParser, CI_TYPES_KEYS } from './ci_type_parser.js';
import { CI_CRUMB_URL } from './run_ci.js';
import { PRBuild } from './build-types/pr_build.js';
import { getPrURL } from '../links.js';
import { debuglog } from '../verbosity.js';
import { FailureFileScanner } from './failure_file_scanner.js';

export class ResumePRJob {
  constructor(cli, request, owner, repo, prid) {
    this.cli = cli;
    this.request = request;
    this.owner = owner;
    this.repo = repo;
    this.prid = prid;
  }

  async checkFailures(jobid) {
    const { cli, request, owner, repo, prid } = this;
    const filenames = new Set();
    for await (const file of request.getPullRequestFiles({ owner, repo, prid })) {
      for (const filename of [file.filename, file.previous_filename].filter(Boolean)) {
        filenames.add(filename);
      }
    }
    const overlaps = new Set();
    const buildRequest = Object.create(request);
    buildRequest.json = async(...args) => {
      const data = await request.json(...args);
      // Inspect failed descendants even when their parent job was aborted.
      return data?.result === 'ABORTED' ? { ...data, result: 'FAILURE' } : data;
    };
    // Reuse the build traversal, but consume console responses directly instead
    // of handing whole logs to its summary parser. Serialize downloads so a
    // match cancels this response and prevents queued logs from being opened.
    let pending = Promise.resolve();
    buildRequest.text = (url) => {
      const scan = pending.then(async() => {
        if (!filenames.size || overlaps.size) return '';
        const scanner = new FailureFileScanner(filenames);
        const match = await scanner.scan(request.stream(url));
        if (match) overlaps.add(match);
        return '';
      });
      pending = scan.catch(debuglog);
      return scan;
    };
    const build = new PRBuild(cli, buildRequest, jobid, Infinity);
    try {
      await build.getResults();
    } catch (err) {
      debuglog(err);
    }
    await pending;
    if (overlaps.size) {
      for (const filename of [...overlaps].sort()) {
        cli.error(filename);
      }
      return false;
    }
    return true;
  }

  async resume() {
    const { cli, request, prid } = this;
    let crumb;
    cli.startSpinner('Validating Jenkins credentials');
    try {
      ({ crumb } = await request.json(CI_CRUMB_URL));
      if (!crumb) {
        throw new Error('Missing Jenkins crumb');
      }
    } catch (err) {
      debuglog(err);
      cli.stopSpinner('Jenkins credentials invalid', cli.SPINNER_STATUS.FAILED);
      return false;
    }
    cli.stopSpinner('Jenkins credentials valid');

    try {
      cli.startSpinner(`Looking for CI runs for pull request ${prid}`);
      const parser = await JobParser.fromPR(getPrURL(this), cli, request);
      const job = parser.parse().get(CI_TYPES_KEYS.PR);
      if (!job) {
        cli.stopSpinner(`No CI run detected from pull request ${prid}`,
          cli.SPINNER_STATUS.FAILED);
        return false;
      }
      cli.stopSpinner(`Found PR CI job ${job.jobid}`);

      const build = new PRBuild(cli, request, job.jobid, undefined,
        'result,building,actions[_class,parameters[name,value]]');
      const { result, building, actions = [] } = await build.getBuildData();
      if (building || (result !== 'FAILURE' && result !== 'ABORTED')) {
        const status = building ? 'RUNNING' : result ?? 'RUNNING';
        cli.error(`CI job ${job.jobid} is in status ${status}, skipping resume`);
        return false;
      }
      if (!actions.some(action =>
        action._class === 'com.tikal.jenkins.plugins.multijob.MultiJobResumeBuild')) {
        cli.error(`CI job ${job.jobid} is not resumable`);
        return false;
      }

      const approvedSHAs = new Set(actions.flatMap(action => action.parameters ?? [])
        .filter(parameter => parameter.name === 'COMMIT_SHA_CHECK')
        .map(parameter => parameter.value));
      const [approvedSHA] = approvedSHAs;
      if (approvedSHAs.size !== 1 || typeof approvedSHA !== 'string' || !approvedSHA) {
        cli.error(`Refusing to resume CI job ${job.jobid}: cannot determine its approved commit`);
        return false;
      }

      cli.startSpinner('Checking failures against changed PR files');
      if (!(await this.checkFailures(job.jobid))) {
        cli.stopSpinner('Refusing to resume CI: failures reference files changed by this PR',
          cli.SPINNER_STATUS.FAILED);
        return false;
      }
      cli.stopSpinner('No changed PR files found in available failure details');

      // Read HEAD after inspecting failures so the comparison is fresh when resuming.
      const pr = await request.getPullRequest(getPrURL(this));
      if (pr.head?.sha !== approvedSHA) {
        cli.error(`Refusing to resume CI job ${job.jobid}: ` +
          'its approved commit does not match the current PR HEAD');
        return false;
      }

      cli.startSpinner(`Resuming PR CI job ${job.jobid}`);
      const response = await request.fetch(`${build.jobUrl}resume`, {
        method: 'POST',
        headers: {
          'Jenkins-Crumb': crumb
        }
      });
      if (response.status !== 200) {
        cli.stopSpinner(
          `Failed to resume PR CI: ${response.status} ${response.statusText}`,
          cli.SPINNER_STATUS.FAILED);
        return false;
      }
      cli.stopSpinner('PR CI job successfully resumed');
    } catch (err) {
      debuglog(err);
      cli.stopSpinner('Failed to resume CI', cli.SPINNER_STATUS.FAILED);
      return false;
    }
    return true;
  }
}
