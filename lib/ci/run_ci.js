import { FormData } from 'undici';

import {
  CI_DOMAIN,
  CI_TYPES,
  CI_TYPES_KEYS
} from './ci_type_parser.js';
import PRData from '../pr_data.js';
import { debuglog } from '../verbosity.js';
import PRChecker from '../pr_checker.js';

export const CI_CRUMB_URL = `https://${CI_DOMAIN}/crumbIssuer/api/json`;
const CI_PR_NAME = CI_TYPES.get(CI_TYPES_KEYS.PR).jobName;
export const CI_PR_URL = `https://${CI_DOMAIN}/job/${CI_PR_NAME}/build`;

const CI_V8_NAME = CI_TYPES.get(CI_TYPES_KEYS.V8).jobName;
export const CI_V8_URL = `https://${CI_DOMAIN}/job/${CI_V8_NAME}/build`;

const REQUEST_CI_COMMENT = /^@nodejs-github-bot .+([0-9a-f]{40})\.*\n*$/;

async function findSafeFullCommitSHA(cli, prData, request) {
  // First, let's check if the head was approved.
  await Promise.all([prData.getReviews(), prData.getCommits()]);

  const approvedHead = new PRChecker(cli, prData, request, {}).getApprovedTipOfHead();
  if (approvedHead) return approvedHead;

  // Else, let's find out if a collaborator added a comment with a full commit SHA.
  await Promise.all([prData.getCollaborators(), prData.getComments()]);
  const collaborators = Array.from(prData.collaborators.values(),
    (c) => c.login.toLowerCase());
  return prData.comments
    .findLast(c =>
      collaborators.includes(c.author.login.toLowerCase()) &&
      REQUEST_CI_COMMENT.test(c.body))
    ?.body.match(REQUEST_CI_COMMENT)[1];
}

export class RunPRJob {
  constructor(cli, request, owner, repo, prid, certifySafe) {
    this.cli = cli;
    this.request = request;
    this.owner = owner;
    this.repo = repo;
    this.prid = prid;
    this.prData = new PRData({ prid, owner, repo }, cli, request);
    this.certifySafe =
      certifySafe ||
      findSafeFullCommitSHA(cli, this.prData, request).then((h) => (this.certifySafe = h));
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
        { name: 'COMMIT_SHA_CHECK', value: this.certifySafe },
        { name: 'TARGET_GITHUB_ORG', value: this.owner },
        { name: 'TARGET_REPO_NAME', value: this.repo },
        { name: 'PR_ID', value: this.prid },
        { name: 'REBASE_ONTO', value: '<pr base branch>' },
        { name: 'DESCRIPTION_SETTER_DESCRIPTION', value: '' }
      ]
    }));
    return payload;
  }

  get v8Payload() {
    const payload = new FormData();
    payload.append('json', JSON.stringify({
      parameter: [
        { name: 'GITHUB_ORG', value: this.owner },
        { name: 'REPO_NAME', value: this.repo },
        { name: 'GIT_REMOTE_REF', value: `refs/pull/${this.prid}/head` }
      ]
    }));
    return payload;
  }

  async start() {
    const { cli, certifySafe } = this;

    if (!(await certifySafe)) {
      cli.info('If the tip of this PR looks safe, add a comment in the form of:');
      cli.info('@nodejs-github-bot test <commit-full-sha-or-URL>');
      cli.error('Refusing to run CI on potentially unsafe PR');
      return false;
    }

    cli.startSpinner('Validating Jenkins credentials');
    const crumb = await this.getCrumb();

    if (crumb === false) {
      cli.stopSpinner('Jenkins credentials invalid',
        this.cli.SPINNER_STATUS.FAILED);
      return false;
    }
    cli.stopSpinner('Jenkins credentials valid');

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

      // check if the job need a v8 build and trigger it
      await this.prData.getPR();
      const labels = this.prData.pr.labels;
      if (labels.nodes.map(i => i.name).includes('v8 engine')) {
        cli.startSpinner('Starting V8 CI job');
        const response = await this.request.fetch(CI_V8_URL, {
          method: 'POST',
          headers: {
            'Jenkins-Crumb': crumb
          },
          body: this.v8Payload
        });
        if (response.status !== 201) {
          cli.stopSpinner(
            `Failed to start V8 CI: ${response.status} ${response.statusText}`,
            this.cli.SPINNER_STATUS.FAILED);
          return false;
        }
        cli.stopSpinner('V8 CI job successfully started');
      }
    } catch (err) {
      debuglog(err);
      cli.stopSpinner('Failed to start CI', this.cli.SPINNER_STATUS.FAILED);
      return false;
    }
    return true;
  }
}
