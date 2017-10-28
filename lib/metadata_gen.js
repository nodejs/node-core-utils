'use strict';

const LinkParser = require('./links');
/**
 * @typedef {{reviewer: Collaborator}} Reviewer
 */
class MetadataGenerator {
  /**
   * @param {string} repo
   * @param {{url: string, bodyHTML: string}} pr
   * @param {{approved: Reviewer[], rejected: Reviewer[]}} reviewers
   */
  constructor(repo, pr, reviewers) {
    this.repo = repo;
    this.pr = pr;
    this.reviewers = reviewers;
  }

  /**
   * @returns {string}
   */
  getMetadata() {
    const { reviewers, repo, pr } = this;

    const prUrl = pr.url;
    const reviewedBy = reviewers.approved;
    const parser = new LinkParser(repo, pr.bodyHTML);
    const fixes = parser.getFixes();
    const refs = parser.getRefs();

    const output = {
      prUrl, reviewedBy, fixes, refs
    };

    const [SCISSOR_LEFT, SCISSOR_RIGHT] = MetadataGenerator.SCISSORS;
    let meta = [
      SCISSOR_LEFT,
      `PR-URL: ${output.prUrl}`
    ];
    meta = meta.concat(output.reviewedBy.map((r) => {
      return `Reviewed-By: ${r.reviewer.getContact()}`;
    }));
    meta = meta.concat(output.fixes.map((fix) => `Fixes: ${fix}`));
    meta = meta.concat(output.refs.map((ref) => `Refs: ${ref}`));
    meta.push(SCISSOR_RIGHT);

    return meta.join('\n');
  }
}

MetadataGenerator.SCISSORS = [
  '-------------------------------- >8 --------------------------------',
  '-------------------------------- 8< --------------------------------'
];

module.exports = MetadataGenerator;
