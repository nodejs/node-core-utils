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
    const { owner, repo, pr, reviewers, argv } = data;
    this.owner = owner;
    this.repo = repo;
    this.pr = pr;
    this.reviewers = reviewers;
    this.argv = argv;
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
    const altPrUrl = parser.getAltPrUrl();
    const meta = [
      ...fixes.map((fix) => `Fixes: ${fix}`),
      ...refs.map((ref) => `Refs: ${ref}`)
    ];
    const backport = this.argv ? this.argv.backport : undefined;
    if (backport) {
      meta.unshift(`Backport-PR-URL: ${prUrl}`);
      meta.unshift(`PR-URL: ${altPrUrl}`);
    } else {
      // Reviews are only added here as backports should not contain reviews
      // for the backport itself in the metadata
      meta.unshift(`PR-URL: ${prUrl}`);
      meta.push(
        ...reviewedBy.map((r) => `Reviewed-By: ${r.reviewer.getContact()}`)
      );
    }
    meta.push(''); // creates final EOL
    return meta.join('\n');
  }
}

module.exports = MetadataGenerator;
