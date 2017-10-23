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
const {
  PENDING, COMMENTED, APPROVED, CHANGES_REQUESTED, DISMISSED
} = require('../lib/review_state');

const FIXES_RE = /Fixes: (\S+)/mg;
const FIX_RE = /Fixes: (\S+)/;
const REFS_RE = /Refs?: (\S+)/mg;
const REF_RE = /Refs?: (\S+)/;
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
  const result = [];
  for (const [ login, review ] of reviewers) {
    if (review.state !== APPROVED) {
      logger.warn(`${login}: ${review.state} ${review.ref}`);
    } else {
      const data = collaborators.get(login);
      result.push({
        name: data.name,
        email: data.email
      });
    }
  }
  return result;
}

async function getFixes(pr) {
  return []; // TODO
}

async function getRefs(pr) {
  return []; // TODO
}

async function main(prid, owner, repo) {
  logger.info(`Requesting ${owner}/${repo}/pull/${prid}`);
  const prData = await request(PR_QUERY, { prid, owner, repo });
  const pr = prData.repository.pullRequest;
  const prUrl = pr.url;

  const vars = { prid, owner, repo };
  logger.info(`Requesting ${owner}/${repo}/pull/${prid}/reviews`);
  const reviews = await requestAll(REVIEWS_QUERY, vars, [
    'repository', 'pullRequest', 'reviews'
  ]);
  logger.info(`Requesting ${owner}/${repo}/pull/${prid}/comments`);
  const comments = await requestAll(COMMENTS_QUERY, vars, [
    'repository', 'pullRequest', 'comments'
  ]);
  const collaborators = await getCollaborators(owner, repo);
  // TODO: check committers against authors
  // TODO: check CI runs
  // TODO: maybe invalidate review after new commits?
  // logger.info(`Requesting ${owner}/${repo}/pull/${prid}/commits`);
  // const commits = await requestAll(COMMITS_QUERY, vars, [
  //   'repository', 'pullRequest', 'commits'
  // ]);

  const reviewedBy = await getReviewers(reviews, comments, collaborators);
  const fixes = await getFixes(reviews, comments);
  const refs = await getRefs(reviews, comments);

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

  logger.info({ raw: meta.join('\n') }, `Generated metadta:`);
}

main(PR_ID, OWNER, REPO).catch((err) => {
  logger.error(err);
  process.exit(-1);
});
