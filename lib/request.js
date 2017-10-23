'use strict';

const rp = require('request-promise-native');
const auth = require('./auth');

async function request(query, variables) {
  const options = {
    uri: 'https://api.github.com/graphql',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'User-Agent': 'node-check-pr'
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

module.exports = request;
