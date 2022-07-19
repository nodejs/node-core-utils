import FormData from 'form-data';

import { BASIC_TREE } from './jenkins_constants.js';
import { TestBuild } from './build-types/test_build.js';
import {
  CI_DOMAIN,
  CI_TYPES,
  CI_TYPES_KEYS
} from './ci_type_parser.js';

export const CI_CRUMB_URL = `https://${CI_DOMAIN}/crumbIssuer/api/json`;
export const CI_PR_NAME = CI_TYPES.get(CI_TYPES_KEYS.PR).jobName;
export const CI_PR_URL = `https://${CI_DOMAIN}/job/${CI_PR_NAME}/build`;
export const CI_PR_RESUME_URL = `https://${CI_DOMAIN}/job/${CI_PR_NAME}/`;

export class RunPRJob {
  constructor(cli, request, owner, repo, prid, jobid) {
    this.cli = cli;
    this.request = request;
    this.owner = owner;
    this.repo = repo;
    this.prid = prid;
    this.jobid = jobid;
  }

  async getCrumb() {
    try {
      const { crumb } = await this.request.json(CI_CRUMB_URL);
      return crumb;
    } catch (e) {
      return false;
    }
  }

  get payload() {
    const payload = new FormData();
    payload.append('json', JSON.stringify({
      parameter: [
        { name: 'CERTIFY_SAFE', value: 'on' },
        { name: 'TARGET_GITHUB_ORG', value: this.owner },
        { name: 'TARGET_REPO_NAME', value: this.repo },
        { name: 'PR_ID', value: this.prid },
        { name: 'REBASE_ONTO', value: '<pr base branch>' },
        { name: 'DESCRIPTION_SETTER_DESCRIPTION', value: '' }
      ]
    }));
    return payload;
  }

  async #validateJenkinsCredentials() {
    const { cli } = this;
    cli.startSpinner('Validating Jenkins credentials');
    const crumb = await this.getCrumb();

    if (crumb === false) {
      cli.stopSpinner('Jenkins credentials invalid',
        this.cli.SPINNER_STATUS.FAILED);
      return { crumb, success: false };
    }
    cli.stopSpinner('Jenkins credentials valid');

    return { crumb, success: true };
  }

  async start() {
    const { cli } = this;
    const { crumb, success } = await this.#validateJenkinsCredentials();
    if (success === false) {
      return false;
    }

    try {
      cli.startSpinner('Starting PR CI job');
      const response = await this.request.fetch(CI_PR_URL, {
        method: 'POST',
        headers: {
          'Jenkins-Crumb': crumb
        },
        body: this.payload
      });
      if (response.status !== 201) {
        cli.stopSpinner(
          `Failed to start PR CI: ${response.status} ${response.statusText}`,
          this.cli.SPINNER_STATUS.FAILED);
        return false;
      }
      cli.stopSpinner('PR CI job successfully started');
    } catch (err) {
      cli.stopSpinner('Failed to start CI', this.cli.SPINNER_STATUS.FAILED);
      return false;
    }
    return true;
  }

  async resume() {
    const { cli, request, jobid } = this;
    const { crumb, success } = await this.#validateJenkinsCredentials();
    if (success === false) {
      return false;
    }

    try {
      cli.startSpinner('Resuming PR CI job');
      const path = `job/${CI_PR_NAME}/${jobid}/`;
      const testBuild = new TestBuild(cli, request, path, BASIC_TREE);
      const { result } = await testBuild.getBuildData();

      if (result !== 'FAILURE') {
        cli.stopSpinner(
          `CI Job is in status ${result ?? 'RUNNING'}, skipping resume`,
          this.cli.SPINNER_STATUS.FAILED);
        return false;
      }

      const resume_url = `${CI_PR_RESUME_URL}${jobid}/resume`;
      const response = await this.request.fetch(resume_url, {
        method: 'POST',
        headers: {
          'Jenkins-Crumb': crumb
        }
      });
      if (response.status !== 200) {
        cli.stopSpinner(
          `Failed to resume PR CI: ${response.status} ${response.statusText}`,
          this.cli.SPINNER_STATUS.FAILED);
        return false;
      }

      cli.stopSpinner('PR CI job successfully resumed');
    } catch (err) {
      cli.stopSpinner('Failed to resume CI', this.cli.SPINNER_STATUS.FAILED);
      return false;
    }
    return true;
  }
}
