import fs from 'node:fs';

import { fetch } from 'undici';

import { CI_DOMAIN } from './ci/ci_type_parser.js';
import proxy from './proxy.js';
import {
  isDebugVerbosity,
  debuglog
} from './verbosity.js';

function wrappedFetch(url, options, ...args) {
  if (isDebugVerbosity()) {
    debuglog('[fetch]', url);
  }
  return fetch(url, options, ...args);
}

export default class Request {
  constructor(credentials) {
    this.credentials = credentials;
    this.proxyAgent = proxy();
  }

  loadQuery(file) {
    const filePath = new URL(`./queries/${file}.gql`, import.meta.url);
    return fs.readFileSync(filePath, 'utf8');
  }

  async fetch(url, options) {
    options.agent = this.proxyAgent;
    if (url.startsWith(`https://${CI_DOMAIN}`)) {
      options.headers = options.headers || {};
      Object.assign(options.headers, this.getJenkinsHeaders());
    } else if (!url.startsWith('https://')) {
      url = new URL(url, 'https://api.github.com/').href;
      options.headers = {
        Authorization: `Basic ${this.credentials.github}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/vnd.github+json',
        ...options.headers
      };
    }
    return wrappedFetch(url, options);
  }

  async buffer(url, options = {}) {
    const res = await this.fetch(url, options);
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer);
  }

  async text(url, options = {}) {
    const res = await this.fetch(url, options);
    if (isDebugVerbosity()) {
      debuglog('[Request] Got response from', url, ':\n', res.status, ' ', res.statusText);
    }
    return res.text();
  }

  async json(url, options = {}) {
    options.headers = options.headers || {};
    const text = await this.text(url, options);
    try {
      return JSON.parse(text);
    } catch (e) {
      if (isDebugVerbosity()) {
        debuglog('[Request] Cannot parse JSON response from',
          url, ':\n', text);
      }
      throw e;
    }
  }

  async createIssue(title, body, { owner, repo }) {
    const url = `/repos/${owner}/${repo}/issues`;
    const options = {
      method: 'POST',
      body: JSON.stringify({
        title,
        body
      })
    };
    return this.json(url, options);
  }

  async commentIssue(fullUrl, comment) {
    const commentUrl = fullUrl.replace('https://github.com/', '/repos/') + '/comments';
    const options = {
      method: 'POST',
      body: JSON.stringify({
        body: comment,
      })
    };
    return this.json(commentUrl, options);
  }

  async getPullRequest(fullUrl) {
    const prUrl = fullUrl.replace('https://github.com/', '/repos/').replace('pull', 'pulls');
    return this.json(prUrl);
  }

  async * getPullRequestFiles({ owner, repo, prid }) {
    let page = 1;
    for (;;) {
      const url =
        `/repos/${owner}/${repo}/pulls/${prid}/files?per_page=100&page=${page}`;
      const batch = await this.json(url);
      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }
      yield * batch;
      if (batch.length < 100) {
        break;
      }
      page++;
    }
  }

  async listDirectory({ owner, repo, path, ref }) {
    let url = `/repos/${owner}/${repo}/contents/${path}`;
    if (ref) {
      url += `?ref=${encodeURIComponent(ref)}`;
    }
    return this.json(url);
  }

  async dispatchWorkflow(workflowId, { owner, repo, ref, inputs }) {
    const url =
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;
    const res = await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify({ ref, inputs })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Failed to dispatch workflow ${workflowId} on ${owner}/${repo}: ` +
        `${res.status} ${res.statusText}${text ? `\n${text}` : ''}`);
    }
    return res;
  }

  async createPullRequest(title, body, { owner, repo, head, base }) {
    const url = `/repos/${owner}/${repo}/pulls`;
    const options = {
      method: 'POST',
      body: JSON.stringify({
        title,
        body,
        head,
        base
      })
    };
    return this.json(url, options);
  }

  async closePullRequest(id, { owner, repo }) {
    const url = `/repos/${owner}/${repo}/pulls/${id}`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state: 'closed'
      })
    };
    return this.json(url, options);
  }

  async gql(name, variables, path) {
    const query = this.loadQuery(name);
    if (path) {
      const result = await this.queryAll(query, variables, path);
      return result;
    } else {
      const result = await this.query(query, variables);
      return result;
    }
  }

  getJenkinsHeaders() {
    const jenkinsCredentials = this.credentials.jenkins;
    if (!jenkinsCredentials) {
      throw new Error('The request has not been ' +
                      'authenticated with a Jenkins token');
    }
    return {
      Authorization: `Basic ${jenkinsCredentials}`,
      'User-Agent': 'node-core-utils'
    };
  }

  async getTriagedReports() {
    const url = 'https://api.hackerone.com/v1/reports?filter[program][]=nodejs&filter[state][]=triaged';
    const options = {
      method: 'GET',
      headers: {
        Authorization: `Basic ${this.credentials.h1}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/json'
      }
    };
    const data = await this.json(url, options);
    if (data?.errors) {
      throw new Error(
        `Request to fetch triaged reports failed with: ${JSON.stringify(data.errors)}`
      );
    }
    return data;
  }

  async getPrograms() {
    const url = 'https://api.hackerone.com/v1/me/programs';
    const options = {
      method: 'GET',
      headers: {
        Authorization: `Basic ${this.credentials.h1}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/json'
      }
    };
    return this.json(url, options);
  }

  async requestCVE(programId, opts) {
    const url = `https://api.hackerone.com/v1/programs/${programId}/cve_requests`;
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.credentials.h1}`,
        'User-Agent': 'node-core-utils',
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(opts)
    };
    return this.json(url, options);
  }

  async updateReportCVE(reportId, opts) {
    const url = `https://api.hackerone.com/v1/reports/${reportId}/cves`;
    const options = {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${this.credentials.h1}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(opts)
    };
    return this.json(url, options);
  }

  async getReport(reportId) {
    const url = `https://api.hackerone.com/v1/reports/${reportId}`;
    const options = {
      method: 'GET',
      headers: {
        Authorization: `Basic ${this.credentials.h1}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/json'
      }
    };
    return this.json(url, options);
  }

  async updateReportState(reportId, state, message) {
    const url = `https://api.hackerone.com/v1/reports/${reportId}/state_changes`;
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.credentials.h1}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          type: 'state-change',
          attributes: {
            message,
            state
          }
        }
      })
    };
    return this.json(url, options);
  }

  async requestDisclosure(reportId) {
    const url = `https://api.hackerone.com/v1/reports/${reportId}/disclosure_requests`;
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.credentials.h1}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          attributes: {
            message: 'Requesting disclosure',
            // default to limited version
            substate: 'no-content'
          }
        }
      })
    };
    return this.json(url, options);
  }

  // This is for github v4 API queries, for other types of queries
  // use .text or .json
  async query(query, variables) {
    const githubCredentials = this.credentials.github;
    if (!githubCredentials) {
      throw new Error('The request has not been ' +
                      'authenticated with a GitHub token');
    }
    const url = '/graphql';
    const options = {
      agent: this.proxyAgent,
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.antiope-preview+json'
      },
      body: JSON.stringify({
        query,
        variables
      })
    };

    const result = await this.json(url, options);
    if (result.errors) {
      const { type, message } = result.errors[0];
      const err = new Error(`[${type}] GraphQL request Error: ${message}`);
      err.data = {
        variables
      };
      throw err;
    }
    if (result.message) {
      const err = new Error(`GraphQL request Error: ${result.message}`);
      err.data = {
        variables
      };
      throw err;
    }
    return result.data;
  }

  async queryAll(query, variables, path) {
    let after = null;
    let all = [];
    // first page
    do {
      const varWithPage = Object.assign({
        after
      }, variables);
      const data = await this.query(query, varWithPage);
      let current = data;
      for (const step of path) {
        current = current[step];
      }
      // current should have:
      //   totalCount
      //   pageInfo { hasNextPage, endCursor }
      //   nodes
      all = all.concat(current.nodes);
      if (current.pageInfo.hasNextPage) {
        after = current.pageInfo.endCursor;
      } else {
        after = null;
      }
    } while (after !== null);

    return all;
  }

  // ---------------------------------------------------------------------------
  // OpenJS Foundation CNA — github.com/UlisesGascon/openjs-cna-api-poc
  //
  // The Worker is a thin edge in front of `workflow_dispatch`. POST /dispatch
  // returns a Worker-minted correlation_id; GET /runs/{id} polls until the
  // backing workflow run completes.
  // ---------------------------------------------------------------------------

  async cnaDispatch(operation, inputs = {}) {
    const { worker_url, token } = this.credentials.cna;
    const url = `${worker_url}/dispatch`;
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'node-core-utils',
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ operation, inputs })
    };
    const response = await this.json(url, options);
    if (response.error) {
      throw new Error(
        `OpenJS CNA dispatch failed (${operation}): ${response.error}`
      );
    }
    return response;
  }

  async cnaPoll(correlationId) {
    const { worker_url, token } = this.credentials.cna;
    const url = `${worker_url}/runs/${correlationId}`;
    const options = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/json'
      }
    };
    return this.json(url, options);
  }

  // Polls /runs/{id} until the workflow reports status === 'completed'.
  // Throws on timeout or on a `conclusion` other than 'success'. Default
  // timeout is generous (10 min) — publish-cve in particular has been seen
  // to take 3-4 min during MITRE staging slowdowns.
  async cnaWaitForCompletion(correlationId, { timeoutMs = 600_000, intervalMs = 5_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.cnaPoll(correlationId);
      if (run.status === 'completed') {
        if (run.conclusion !== 'success') {
          throw new Error(
            `OpenJS CNA run ${correlationId} concluded with ` +
            `'${run.conclusion}'. See ${run.url} for details.`
          );
        }
        return run;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `OpenJS CNA run ${correlationId} did not complete within ${timeoutMs}ms`
    );
  }

  // Reserve a CVE id via the OpenJS CNA. /runs/{correlation_id} surfaces the
  // operation result (e.g. `{ cve_id: "CVE-2026-..." }`) on the same response
  // once the run completes, so the caller only needs to await this one method.
  async cnaReserveCve(opts = {}) {
    const dispatch = await this.cnaDispatch('reserve-cve', opts);
    const run = await this.cnaWaitForCompletion(dispatch.correlation_id, opts);
    return {
      correlation_id: dispatch.correlation_id,
      run_url: run.url,
      run_id: run.run_id,
      result: run.result // shape depends on the operation; reserve returns { cve_id }
    };
  }

  // Publish a v5.2 CNA Container against an already-reserved CVE id.
  async cnaPublishCve(cveId, cnaContainer, opts = {}) {
    const dispatch = await this.cnaDispatch('publish-cve', {
      cve_id: cveId,
      cnaContainer
    });
    const run = await this.cnaWaitForCompletion(dispatch.correlation_id, opts);
    return {
      correlation_id: dispatch.correlation_id,
      run_url: run.url,
      run_id: run.run_id,
      result: run.result
    };
  }
}
