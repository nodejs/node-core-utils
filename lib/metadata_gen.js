'use strict';

const LinkParser = require('./links');

/**
 * @typedef {{reviewer: Collaborator}} Reviewer
 */
class MetadataGenerator {
  /**
   * @param {PRData} data
   */
  constructor(data) {
    const { owner, repo, pr, reviewers } = data;
    this.owner = owner;
    this.repo = repo;
    this.pr = pr;
    this.reviewers = reviewers;
  }

  /**
   * @returns {string}
   */
  getMetadata() {
    const {
      reviewers: { approved: reviewedBy },
      pr: { url: prUrl, bodyHTML: op },
      owner,
      repo
    } = this;

    const parser = new LinkParser(owner, repo, op);
    const fixes = parser.getFixes();
    const refs = parser.getRefs();

    let meta = [
      `PR-URL: ${prUrl}`,
      ...fixes.map((fix) => `Fixes: ${fix}`),
      ...refs.map((ref) => `Refs: ${ref}`),
      ...reviewedBy.map((r) => `Reviewed-By: ${r.reviewer.getContact()}`),
      '' // creates final EOL
    ];

    return meta.join('\n');
  }
}

module.exports = MetadataGenerator;
