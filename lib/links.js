'use strict';

const FIXES_RE = /(Close[ds]?|Fix(e[ds])?|Resolve[sd]?)\s*:\s*(\S+)/mgi;
const FIX_RE = /(Close[ds]?|Fix(e[ds])?|Resolve[sd]?)\s*:\s*(\S+)/i;
const REFS_RE = /Refs?\s*:\s*(\S+)/mgi;
const REF_RE = /Refs?\s*:\s*(\S+)/i;
const { JSDOM } = require('jsdom');

/**
 * Most of this class is ported from node-review
 */
class LinkParser {
  constructor(owner, repo, html) {
    this.owner = owner;
    this.repo = repo;
    this.OP = JSDOM.fragment(html);
  }

  getFixesUrlsFromArray(arr) {
    const { owner, repo } = this;
    const result = [];
    for (const item of arr) {
      const m = item.match(FIX_RE);
      if (!m) continue;
      const fix = m[3];
      const url = fix.replace(/^#/, `${owner}/${repo}#`).replace('#', '/issues/');
      result.push(`https://github.com/${url}`);
    }
    return result;
  }

  getRefsUrlsFromArray(arr) {
    const result = [];
    for (const item of arr) {
      const m = item.match(REF_RE);
      if (!m) continue;
      const ref = m[1];
      const url = this.getRefUrlFromOP(ref);
      if (url) result.push(url);
    }
    return result;
  }

  // Do this so we can reliably get the correct url.
  // Otherwise, the number could reference a PR or an issue.
  getRefUrlFromOP(ref) {
    const as = this.OP.querySelectorAll('a.issue-link');
    const links = Array.from(as);
    for (const link of links) {
      const text = link.textContent;
      if (text === ref) {
        const href = link.getAttribute('href');
        if (href) return href;
      }
    }
  }

  getFixes() {
    const text = this.OP.textContent;
    const fixes = text.match(FIXES_RE);
    if (fixes) {
      return this.getFixesUrlsFromArray(fixes);
    }
    return [];
  }

  getRefs() {
    const text = this.OP.textContent;
    const refs = text.match(REFS_RE);
    if (refs) {
      return this.getRefsUrlsFromArray(refs);
    }
    return [];
  }
};

module.exports = LinkParser;
