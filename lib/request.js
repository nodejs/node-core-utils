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
    }
    return wrappedFetch(url, options);
  }

  async buffer(url, options = {}) {
    const res = await this.fetch(url, options);
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer);
  }

  async text(url, options = {}) {
    return this.fetch(url, options).then(res => res.text());
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
    const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.credentials.github}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({
        title,
        body
      })
    };
    return this.json(url, options);
  }

  async getPullRequest(fullUrl) {
    const prUrl = fullUrl.replace('https://github.com/', 'https://api.github.com/repos/').replace('pull', 'pulls');
    const options = {
      method: 'GET',
      headers: {
        Authorization: `Basic ${this.credentials.github}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/vnd.github+json'
      }
    };
    return this.json(prUrl, options);
  }

  async createPullRequest(title, body, { owner, repo, head, base }) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.credentials.github}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({
        title,
        body,
        head,
        base
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
    return this.json(url, options);
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

  // This is for github v4 API queries, for other types of queries
  // use .text or .json
  async query(query, variables) {
    const githubCredentials = this.credentials.github;
    if (!githubCredentials) {
      throw new Error('The request has not been ' +
                      'authenticated with a GitHub token');
    }
    const url = 'https://api.github.com/graphql';
    const options = {
      agent: this.proxyAgent,
      method: 'POST',
      headers: {
        Authorization: `Basic ${githubCredentials}`,
        'User-Agent': 'node-core-utils',
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
}
