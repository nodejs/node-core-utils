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
const COMMITS_QUERY = loadQuery('PRCommits');

const { request, requestAll } = require('../lib/request');
const { getCollaborators } = require('../lib/collaborators');
const logger = require('../lib/logger');
const { ascending } = require('../lib/comp');
const LinkParser = require('../lib/links');

const {
  PENDING, COMMENTED, APPROVED, CHANGES_REQUESTED, DISMISSED
} = require('../lib/review_state');

const LGTM_RE = /(\W|^)lgtm(\W|$)/i;

// const REFERENCE_RE = /referenced this pull request in/

const OWNER = 'nodejs';
const REPO = 'node';

const PR_ID = parseInt(process.argv[2]) || 14782;  // example

function mapByGithubReviews(reviews, collaborators) {
  const map = new Map();
  const list = reviews
    .filter((r) => r.state !== PENDING && r.state !== COMMENTED)
    .filter((r) => {
      return (r.author && r.author.login &&  // could be a ghost
              collaborators.get(r.author.login.toLowerCase()));
    }).sort((a, b) => {
      return ascending(a.publishedAt, b.publishedAt);
    });

  for (const r of list) {
    const login = r.author.login.toLowerCase();
    const entry = map.get(login);
    if (!entry) {  // initialize
      map.set(login, {
        state: r.state,
        date: r.publishedAt,
        ref: r.url
      });
    }
    switch (r.state) {
      case APPROVED:
      case CHANGES_REQUESTED:
        // Overwrite previous, whether initalized or not
        map.set(login, {
          state: r.state,
          date: r.publishedAt,
          ref: r.url
        });
        break;
      case DISMISSED:
        // TODO: check the state of the dismissed review?
        map.delete(login);
        break;
    }
  }
  return map;
}

// TODO: count -1 ...? But they should make it explicit
/**
 * @param {Map} oldMap 
 * @param {{}[]} comments 
 * @param {Map} collaborators 
 * @returns {Map}
 */
function updateMapByRawReviews(oldMap, comments, collaborators) {
  const withLgtm = comments.filter((c) => LGTM_RE.test(c.bodyText))
    .filter((c) => {
      return (c.author && c.author.login &&  // could be a ghost
              collaborators.get(c.author.login.toLowerCase()));
    }).sort((a, b) => {
      return ascending(a.publishedAt, b.publishedAt);
    });

  for (const c of withLgtm) {
    const login = c.author.login.toLowerCase();
    const entry = oldMap.get(login);
    if (!entry || entry.publishedAt < c.publishedAt) {
      logger.info(`${login} approved via LGTM in comments`);
      oldMap.set(login, {
        state: APPROVED,
        date: c.publishedAt,
        ref: c.bodyText  // no url, have to use bodyText
      });
    }
  }
  return oldMap;
}
/**
 * @param {{}[]} reviewes 
 * @param {{}[]} comments 
 * @param {Map} collaborators 
 * @returns {Map}
 */
async function getReviewers(reviews, comments, collaborators) {
  const ghReviews = mapByGithubReviews(reviews, collaborators);
  const reviewers = updateMapByRawReviews(ghReviews, comments, collaborators);
  const result = {
    approved: [],
    rejected: []
  };
  for (const [ login, review ] of reviewers) {
    const reviwer = collaborators.get(login);
    if (review.state === APPROVED) {
      result.approved.push(Object.assign({ review }, reviwer));
    } else if (review.state === CHANGES_REQUESTED) {
      result.rejected.push(Object.assign({ review }, reviwer));
    }
  }
  return result;
}

async function main(prid, owner, repo) {
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
  const collaborators = await getCollaborators(owner, repo);
  // TODO: check committers against authors
  // TODO: check CI runs
  // TODO: maybe invalidate review after new commits?
  // logger.trace(`Getting commits from ${owner}/${repo}/pull/${prid}`);
  // const commits = await requestAll(COMMITS_QUERY, vars, [
  //   'repository', 'pullRequest', 'commits'
  // ]);

  const reviewers = await getReviewers(reviews, comments, collaborators);
  if (reviewers.rejected.length > 0) {
    for (const { name, login, review } of reviewers.rejected) {
      logger.warn(`${name}(${login}) rejected in ${review.ref}`);
    }
  }
  if (reviewers.approved.length === 0) {
    logger.warn('This PR has not been approved yet');
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
  meta = meta.concat(output.reviewedBy.map((reviewer) => {
    return `Reviewed-By: ${reviewer.name} <${reviewer.email}>`;
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
    logger.warn(`Rejections: ${reviewers.rejected.length}`);
  }
  if (reviewers.approved.length === 0) {
    logger.warn(`Approvals: 0`);
  } else {
    logger.info(`Approvals: ${reviewers.approved.length}`);
  }
}

main(PR_ID, OWNER, REPO).catch((err) => {
  logger.error(err);
  process.exit(-1);
});
