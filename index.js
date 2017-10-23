'use strict';

const fs = require('fs');

const PR_QUERY = fs.readFileSync('./queries/PR.gql', 'utf8');
const request = require('./lib/request');
const logger = require('./lib/logger');
const PR_ID = parseInt(process.argv[2]) || 12756;
const OWNER = 'nodejs';
const REPO = 'node';

function getReviewers(pr) {
  return []; // TODO
}

function getFixes(pr) {
  return []; // TODO
}

function getRefs(pr) {
  return []; // TODO
}

async function main() {
  logger.info(`Requesting ${OWNER}/${REPO}/pull/${PR_ID}`);
  const data = await request(PR_QUERY, {
    prid: PR_ID,
    owner: OWNER,
    repo: REPO
  });

  const pr = data.repository.pullRequest;
  const output = {
    prUrl: pr.url,
    reviewedBy: getReviewers(pr),
    fixes: getFixes(pr),
    refs: getRefs(pr)
  };

  let meta = [
    '-------------------------------- >8 --------------------------------',
    `PR-URL: ${output.prUrl}`];
  meta = meta.concat(output.reviewedBy.map((reviewer) => {
    return `Reviewed-By: ${reviewer.name} <${reviewer.email}>`;
  }));
  meta = meta.concat(output.fixes.map((fix) => {
    return `Fixes: ${fix}`;
  }));
  meta = meta.concat(output.refs.map((ref) => {
    return `Refs: ${ref}`;
  }));
  meta.push(
    '-------------------------------- 8< --------------------------------'
  );

  logger.info({ raw: meta.join('\n') }, `Generated metadta:`);
}

main().catch((err) => {
  logger.error(err);
  process.exit(-1);
});
