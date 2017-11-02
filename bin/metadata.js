#!/usr/bin/env node
'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

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
const logger = require('../lib/logger');
const { ReviewAnalyzer } = require('../lib/reviews');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

// const REFERENCE_RE = /referenced this pull request in/

const applyFlagIndex = process.argv.indexOf('-a');
let SHOULD_APPLY_PR = false;
if (applyFlagIndex !== -1) {
  SHOULD_APPLY_PR = true;
  process.argv.splice(applyFlagIndex, 1);
}

const PR_ID = parsePRId(process.argv[2]);
const OWNER = process.argv[3] || 'nodejs';
const REPO = process.argv[4] || 'node';

async function main(prid, owner, repo, shouldApplyPR) {
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
  const metadataLog = `${MetadataGenerator.SCISSORS[0]}\n` +
                      `${metadata}\n${MetadataGenerator.SCISSORS[1]}`;
  logger.info({ raw: metadataLog }, 'Generated metadata:');

  /**
   * TODO: put all these data into one object with a class
   */
  const checker = new PRChecker(logger, pr, reviewers, comments, reviews,
    commits, collaborators);
  const status = checker.checkAll();

  if (shouldApplyPR && status) {
    const shouldApplyMetadata = commits.length === 1 &&
                                checkCommitForMetadata(commits[0]);
    logger.info(`Commits: ${commits.length}`);
    logger.trace('Applying patch on top of current branch');
    try {
      await execAsync(
        `curl -L https://github.com/nodejs/node/pull/${prid}.patch` +
        ' | git am --whitespace=fix'
      );
    } catch (err) {
      return logger.error(err);
    }

    logger.info('Successfully applied patch on top of current branch');

    if (shouldApplyMetadata) {
      exec(
        `git commit --amend -m ${escape(`${commits[0].commit.message}\n\n${metadata}`)}`,
        () => logger.info('Successfully applied metadata to the commit')
      );
    }
  }
}

main(PR_ID, OWNER, REPO, SHOULD_APPLY_PR).catch((err) => {
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

function checkCommitForMetadata(commit) {
  return !(/(Fixes:\s*(\S+))|(Refs:\s*(\S+))|(PR:\s*(\S+))/.test(commit));
}

function escape(str) {
  str = `'${str.replace(/'/g, "'\\''")}'`;
  str = str.replace(/^(?:'')+/g, '').replace(/\\'''/g, "\\'");
  return str;
}
