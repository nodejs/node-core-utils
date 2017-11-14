'use strict';

const rp = require('request-promise-native');

// create a valid user agent required by GitHub API v3,
const userAgent =
  'node-core-utils/v1 (https://github.com/nodejs/node-core-utils)';

class Request {
  constructor(credentials) {
    // GitHub API v3 does not require authorization
    // although the rate is only 60 queries per hour,
    // whereas token can get us 5000 queries per hour.
    this.token = credentials.token;
  }

  async query(query) {
    const options = {
      uri: `https://api.github.com/${query}`,
      method: 'GET',
      json: true,
      gzip: true,
      headers: {
        'Authorization': `token ${this.token}`,
        'User-Agent': userAgent
      }
    };

    const result = await rp(options);
    if (result.errors) {
      const err = new Error('GitHub API v3 Request error request url:');
      err.data = {
        query: query,
        url: `https://api.github.com/${query}`,
        error: result.errors
      };
      throw err;
    }
    return result;
  }
}

module.exports = Request;
