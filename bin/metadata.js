#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadQuery(file) {
  const filePath = path.resolve(__dirname, '..', 'queries', `${file}.gql`);
  return fs.readFileSync(filePath, 'utf8');
}
const PR_QUERY = loadQuery('PR');
const REVIEWS_QUERY = loadQuery('Reviews');
const COMMENTS_QUERY = loadQuery('PRComments');
// const COMMITS_QUERY = loadQuery('PRCommits');

const { request, requestAll } = require('../lib/request');
const { getCollaborators } = require('../lib/collaborators');
const logger = require('../lib/logger');
const LinkParser = require('../lib/links');
const ReviewAnalyzer = require('../lib/reviews');

// const REFERENCE_RE = /referenced this pull request in/

const OWNER = 'nodejs';
const REPO = 'node';

const PR_ID = parseInt(process.argv[2]) || 14782;  // example

function getHint(people) {
  const fromTSC = people.filter((p) => p.reviewer.isTSC());
  let hint = '';
  if (fromTSC.length > 0) {
    const list = `(${fromTSC.map((p) => p.reviewer.login).join(', ')})`;
    hint = `, ${fromTSC.length} from TSC ${list}`;
  }
  return hint;
}

async function main(prid, owner, repo) {
  logger.trace(`Getting collaborator contacts from README of ${owner}/${repo}`);
  const collaborators = await getCollaborators(owner, repo);

  logger.trace(`Getting PR from ${owner}/${repo}/pull/${prid}`);
  const prData = await request(PR_QUERY, { prid, owner, repo });
  const pr = prData.repository.pullRequest;
  const prUrl = pr.url;

  const vars = { prid, owner, repo };
  logger.trace(`Getting reviews from ${owner}/${repo}/pull/${prid}`);
  const reviews = await requestAll(REVIEWS_QUERY, vars, [
    'repository', 'pullRequest', 'reviews'
  ]);
  logger.trace(`Getting comments from ${owner}/${repo}/pull/${prid}`);
  const comments = await requestAll(COMMENTS_QUERY, vars, [
    'repository', 'pullRequest', 'comments'
  ]);

  // TODO: check committers against authors
  // TODO: check CI runs
  // TODO: maybe invalidate review after new commits?
  // logger.trace(`Getting commits from ${owner}/${repo}/pull/${prid}`);
  // const commits = await requestAll(COMMITS_QUERY, vars, [
  //   'repository', 'pullRequest', 'commits'
  // ]);

  const analyzer = new ReviewAnalyzer(reviews, comments, collaborators);
  const reviewers = analyzer.getReviewers();
  if (reviewers.rejected.length > 0) {
    for (const { reviewer, review } of reviewers.rejected) {
      logger.warn(`${reviewer.getName()}) rejected in ${review.ref}`);
    }
  }
  if (reviewers.approved.length === 0) {
    logger.warn('This PR has not been approved yet');
  } else {
    for (const { reviewer, review } of reviewers.approved) {
      if (review.source === ReviewAnalyzer.SOURCES.FROM_COMMENT) {
        logger.info(`${reviewer.getName()}) approved in via LGTM in comments`);
      }
    }
  }

  const reviewedBy = reviewers.approved;
  const parser = new LinkParser(repo, pr.bodyHTML);
  const fixes = parser.getFixes();
  const refs = parser.getRefs();

  const output = {
    prUrl, reviewedBy, fixes, refs
  };

  let meta = [
    '-------------------------------- >8 --------------------------------',
    `PR-URL: ${output.prUrl}`
  ];
  meta = meta.concat(output.reviewedBy.map((r) => {
    return `Reviewed-By: ${r.reviewer.getContact()}>`;
  }));
  meta = meta.concat(output.fixes.map((fix) => `Fixes: ${fix}`));
  meta = meta.concat(output.refs.map((ref) => `Refs: ${ref}`));
  meta.push(
    '-------------------------------- 8< --------------------------------'
  );
  logger.info({ raw: meta.join('\n') }, 'Generated metadta:');

  if (reviewers.rejected.length === 0) {
    logger.info(`Rejections: 0`);
  } else {
    const hint = getHint(reviewers.rejected);
    logger.warn(`Rejections: ${reviewers.rejected.length}${hint}`);
  }
  if (reviewers.approved.length === 0) {
    logger.warn(`Approvals: 0`);
  } else {
    const hint = getHint(reviewers.approved);
    logger.info(`Approvals: ${reviewers.approved.length}${hint}`);
    const labels = pr.labels.nodes.map((l) => l.name);
    if (labels.includes('semver-major')) {
      if (reviewers.approved.filter((p) => p.reviewer.isTSC()) < 2) {
        logger.warn('semver-major requires at least two TSC approvals');
      }
    }
  }
}

main(PR_ID, OWNER, REPO).catch((err) => {
  logger.error(err);
  process.exit(-1);
});
