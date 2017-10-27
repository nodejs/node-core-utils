'use strict';

const rp = require('request-promise-native');
const auth = require('./auth');

async function request(query, variables) {
  const options = {
    uri: 'https://api.github.com/graphql',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${await auth()}`,
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

async function requestAll(query, variables, path) {
  let after = null;
  let all = [];
  // first page
  do {
    const varWithPage = Object.assign({
      after
    }, variables);
    const data = await request(query, varWithPage);
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

module.exports = {
  request,
  requestAll
};
