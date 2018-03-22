'use strict';

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class Request {
  constructor(credentials) {
    this.credentials = credentials;
  }

  loadQuery(file) {
    const filePath = path.resolve(__dirname, 'queries', `${file}.gql`);
    return fs.readFileSync(filePath, 'utf8');
  }

  async text(url, options) {
    return fetch(url, options).then(res => res.text());
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

  async query(query, variables) {
    const url = 'https://api.github.com/graphql';
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.credentials}`,
        'User-Agent': 'node-core-utils'
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
