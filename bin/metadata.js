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
const ReviewAnalyzer = require('../lib/reviews');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

// const REFERENCE_RE = /referenced this pull request in/

const OWNER = 'nodejs';
const REPO = 'node';

const PR_ID = parsePRId(process.argv[2]);

async function main(prid, owner, repo) {
  logger.trace(`Getting collaborator contacts from README of ${owner}/${repo}`);
  const collaborators = await getCollaborators(owner, repo);

  logger.trace(`Getting PR from ${owner}/${repo}/pull/${prid}`);
  const prData = await request(PR_QUERY, { prid, owner, repo });
  const pr = prData.repository.pullRequest;

  const vars = { prid, owner, repo };
  logger.trace(`Getting reviews from ${owner}/${repo}/pull/${prid}`);
  const reviews = await requestAll(REVIEWS_QUERY, vars, [
    'repository', 'pullRequest', 'reviews'
  ]);
  logger.trace(`Getting comments from ${owner}/${repo}/pull/${prid}`);
  const comments = await requestAll(COMMENTS_QUERY, vars, [
    'repository', 'pullRequest', 'comments'
  ]);

  // logger.trace(`Getting commits from ${owner}/${repo}/pull/${prid}`);
  // const commits = await requestAll(COMMITS_QUERY, vars, [
  //   'repository', 'pullRequest', 'commits'
  // ]);

  const analyzer = new ReviewAnalyzer(reviews, comments, collaborators);
  const reviewers = analyzer.getReviewers();
  const metadata = new MetadataGenerator(repo, pr, reviewers).getMetadata();
  logger.info({ raw: metadata }, 'Generated metadata:');

  const checker = new PRChecker(pr, reviewers, comments, reviews);
  checker.checkReviewers();
  checker.checkReviews();
  checker.checkPRWait();
  checker.checkCI();
  // TODO: check committers against authors
  // TODO: maybe invalidate review after new commits?
}

main(PR_ID, OWNER, REPO).catch((err) => {
  logger.error(err);
  process.exit(-1);
});

function parsePRId(id) {
  // Fast path: numeric string
  if (`${+id}` === id) { return +id; }
  const match = id.match(/^https:.*\/pull\/([0-9]+)(?:\/(?:files)?)?$/);
  if (match !== null) { return +match[1]; }
  throw new Error(`Could not understand PR id format: ${id}`);
}
