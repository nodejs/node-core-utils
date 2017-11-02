'use strict';

const rp = require('request-promise-native');
const fs = require('fs');
const path = require('path');

class Request {
  constructor(credentials) {
    this.credentials = credentials;
  }

  loadQuery(file) {
    const filePath = path.resolve(__dirname, '..', 'queries', `${file}.gql`);
    return fs.readFileSync(filePath, 'utf8');
  }

  async promise() {
    return rp(...arguments);
  }

  async gql(name, variables, path) {
    const query = this.loadQuery(name);
    if (path) {
      const result = await this.requestAll(query, variables, path);
      return result;
    } else {
      const result = await this.request(query, variables);
      return result;
    }
  }

  async request(query, variables) {
    const options = {
      uri: 'https://api.github.com/graphql',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.credentials}`,
        'User-Agent': 'node-core-utils'
      },
      json: true,
      gzip: true,
      body: {
        query: query,
        variables: variables
      }
    };
    // console.log(options);
    const result = await rp(options);
    if (result.errors) {
      const err = new Error('GraphQL request Error');
      err.data = {
        // query: query,
        variables: variables,
        errors: result.errors
      };
      throw err;
    }
    return result.data;
  }

  async requestAll(query, variables, path) {
    let after = null;
    let all = [];
    // first page
    do {
      const varWithPage = Object.assign({
        after
      }, variables);
      const data = await this.request(query, varWithPage);
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
