'use strict';

const LinkParser = require('./links');

class MetadataGenerator {
  constructor(repo, pr, reviewers) {
    this.repo = repo;
    this.pr = pr;
    this.reviewers = reviewers;
  }

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

    return meta.join('\n');
  }
}

module.exports = MetadataGenerator;
