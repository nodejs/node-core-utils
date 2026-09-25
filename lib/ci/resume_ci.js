import { JobParser, CI_TYPES_KEYS } from './ci_type_parser.js';
import { CI_CRUMB_URL } from './run_ci.js';
import { PRBuild } from './build-types/pr_build.js';
import { getPrURL } from '../links.js';
import { debuglog } from '../verbosity.js';
import { FailureFileScanner } from './failure_file_scanner.js';
import { findResumableBuild, getApprovedSHA, RESUME_TREE } from './resumable_build.js';
import { getCIActionAdvice } from './ci_utils.js';

export class ResumePRJob {
  constructor(cli, request, owner, repo, prid) {
    this.cli = cli;
    this.request = request;
    this.owner = owner;
    this.repo = repo;
    this.prid = prid;
  }

  reportUnavailable(jobid, build) {
    const { cli } = this;
    cli.stopSpinner(
      `Cannot resume PR CI job ${jobid}: Jenkins does not offer a "Resume build" action. ` +
      getCIActionAdvice(this, 'run'),
      cli.SPINNER_STATUS.FAILED);
    cli.error(build.jobUrl);
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
      cli.stopSpinner(`Unable to validate Jenkins credentials: ${err.message}`,
        cli.SPINNER_STATUS.FAILED);
      return false;
    }
    cli.stopSpinner('Jenkins credentials valid');

    let failureMessage = `Failed to find CI runs for pull request ${prid}`;
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

      failureMessage = `Failed to load PR CI job ${job.jobid}`;
      const latestBuild = new PRBuild(cli, request, job.jobid, undefined, RESUME_TREE);
      const data = await latestBuild.getBuildData();
      const { result, building } = data;
      if (building || (result !== 'FAILURE' && result !== 'ABORTED')) {
        const status = building ? 'RUNNING' : result ?? 'RUNNING';
        cli.error(`CI job ${job.jobid} is in status ${status}, skipping resume`);
        return false;
      }
      const approvedSHA = getApprovedSHA(data);
      if (!approvedSHA) {
        cli.error(`Refusing to resume CI job ${job.jobid}: cannot determine its approved commit`);
        return false;
      }

      failureMessage = `Failed to check resume availability for PR CI job ${job.jobid}`;
      cli.startSpinner(`Checking whether PR CI job ${job.jobid} can be resumed`);
      const { build, jobid: resumeJobid, checkedBuilds } = await findResumableBuild(cli, request, {
        jobid: job.jobid, owner: this.owner, repo: this.repo, prid
      }, data);
      if (!build) {
        this.reportUnavailable(job.jobid, latestBuild);
        return false;
      }
      cli.stopSpinner('Jenkins offers a Resume build action');
      if (resumeJobid !== job.jobid) {
        cli.info(`Using resumable ancestor PR CI job ${resumeJobid} for latest job ${job.jobid}`);
      }

      failureMessage = `Failed to check failures for PR CI job ${job.jobid}`;
      cli.startSpinner('Checking failures against changed PR files');
      for (const { jobid } of checkedBuilds) {
        if (!(await this.checkFailures(jobid))) {
          cli.stopSpinner('Refusing to resume CI: failures reference files changed by this PR',
            cli.SPINNER_STATUS.FAILED);
          return false;
        }
      }
      cli.stopSpinner('No changed PR files found in available failure details');

      // Read HEAD after inspecting failures so the comparison is fresh when resuming.
      failureMessage = `Failed to read the current HEAD for pull request ${prid}`;
      const pr = await request.getPullRequest(getPrURL(this));
      if (pr.head?.sha !== approvedSHA) {
        cli.error(`Refusing to resume CI job ${job.jobid}: ` +
          'its approved commit does not match the current PR HEAD');
        return false;
      }

      failureMessage = `Failed to resume PR CI job ${resumeJobid}`;
      cli.startSpinner(`Resuming PR CI job ${resumeJobid}`);
      const response = await request.fetch(`${build.jobUrl}resume/`, {
        method: 'POST',
        headers: {
          'Jenkins-Crumb': crumb
        }
      });
      await response.body?.cancel();
      // The action may disappear after the preflight check.
      if (response.status === 404) {
        this.reportUnavailable(resumeJobid, build);
        return false;
      }
      if (response.status !== 200) {
        const status = `HTTP ${response.status} ${response.statusText ?? ''}`.trim();
        const reason = response.status === 401 || response.status === 403
          ? `Jenkins denied the request (${status}). ` +
            'Check your Jenkins credentials and build permissions.'
          : `Jenkins returned ${status}. Check the build page for details: ${build.jobUrl}`;
        cli.stopSpinner(
          `${failureMessage}: ${reason}`,
          cli.SPINNER_STATUS.FAILED);
        return false;
      }
      cli.stopSpinner('PR CI job successfully resumed');
    } catch (err) {
      debuglog(err);
      cli.stopSpinner(`${failureMessage}: ${err.message}`, cli.SPINNER_STATUS.FAILED);
      return false;
    }
    return true;
  }
}
