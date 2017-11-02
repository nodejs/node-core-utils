#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { EOL } = require('os');

function loadQuery(file) {
  const filePath = path.resolve(__dirname, '..', 'queries', `${file}.gql`);
  return fs.readFileSync(filePath, 'utf8');
}
const PR_QUERY = loadQuery('PR');
const REVIEWS_QUERY = loadQuery('Reviews');
const COMMENTS_QUERY = loadQuery('PRComments');
const COMMITS_QUERY = loadQuery('PRCommits');
const USER_QUERY = loadQuery('User');

const { request, requestAll } = require('../lib/request');
const { getCollaborators } = require('../lib/collaborators');
const loggerFactory = require('../lib/logger');
const { ReviewAnalyzer } = require('../lib/reviews');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

// const REFERENCE_RE = /referenced this pull request in/

const PR_ID = parsePRId(process.argv[2]);
const OWNER = process.argv[3] || 'nodejs';
const REPO = process.argv[4] || 'node';

async function main(prid, owner, repo, logger) {
  logger.trace(`Getting collaborator contacts from README of ${owner}/${repo}`);
  const collaborators = await getCollaborators(logger, owner, repo);

  logger.trace(`Getting PR from ${owner}/${repo}/pull/${prid}`);
  const prData = await request(PR_QUERY, { prid, owner, repo });
  const pr = prData.repository.pullRequest;

  // Get the mail
  logger.trace(`Getting User information for ${pr.author.login}`);
  const userData = await request(USER_QUERY, { login: pr.author.login });
  const user = userData.user;
  Object.assign(pr.author, user);

  const vars = { prid, owner, repo };
  logger.trace(`Getting reviews from ${owner}/${repo}/pull/${prid}`);
  const reviews = await requestAll(REVIEWS_QUERY, vars, [
    'repository', 'pullRequest', 'reviews'
  ]);
  logger.trace(`Getting comments from ${owner}/${repo}/pull/${prid}`);
  const comments = await requestAll(COMMENTS_QUERY, vars, [
    'repository', 'pullRequest', 'comments'
  ]);

  logger.trace(`Getting commits from ${owner}/${repo}/pull/${prid}`);
  const commits = await requestAll(COMMITS_QUERY, vars, [
    'repository', 'pullRequest', 'commits'
  ]);

  const analyzer = new ReviewAnalyzer(reviews, comments, collaborators);
  const reviewers = analyzer.getReviewers();
  const metadata = new MetadataGenerator(repo, pr, reviewers).getMetadata();

  const [SCISSOR_LEFT, SCISSOR_RIGHT] = MetadataGenerator.SCISSORS;
  logger.info({
    raw: [SCISSOR_LEFT, metadata, SCISSOR_RIGHT].join(EOL)
  }, 'Generated metadata:');

  if (!process.stdout.isTTY) {
    process.stdout.write(`${metadata}${EOL}`);
  }

  /**
   * TODO: put all these data into one object with a class
   */
  const checker = new PRChecker(logger, pr, reviewers, comments, reviews,
    commits, collaborators);
  checker.checkAll();
}

const logStream = process.stdout.isTTY ? process.stdout : process.stderr;
const logger = loggerFactory(logStream);
main(PR_ID, OWNER, REPO, logger).catch((err) => {
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
