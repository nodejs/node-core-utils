'use strict';

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { CI_DOMAIN } = require('./ci/ci_type_parser');
const proxy = require('./proxy');

class Request {
  constructor(credentials) {
    this.credentials = credentials;
    this.proxyAgent = proxy();
  }

  loadQuery(file) {
    const filePath = path.resolve(__dirname, 'queries', `${file}.gql`);
    return fs.readFileSync(filePath, 'utf8');
  }

  async text(url, options = {}) {
    options.agent = this.proxyAgent;
    if (url.startsWith(`https://${CI_DOMAIN}`)) {
      options.headers = options.headers || {};
      Object.assign(options.headers, this.getJenkinsHeaders());
    }
    return fetch(url, options).then(res => res.text());
  }

  async json(url, options = {}) {
    options.agent = this.proxyAgent;
    options.headers = options.headers || {};
    options.headers.Accept = 'application/json';
    if (url.startsWith(`https://${CI_DOMAIN}`)) {
      Object.assign(options.headers, this.getJenkinsHeaders());
    }
    return fetch(url, options).then(res => res.json());
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
        query: query,
        variables: variables
      })
    };

    const result = await fetch(url, options).then(res => res.json());
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

module.exports = Request;
