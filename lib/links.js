'use strict';

const FIXES_RE = /Fixes:\s*(\S+)/mg;
const FIX_RE = /Fixes:\s*(\S+)/;
const REFS_RE = /Refs?:\s*(\S+)/mg;
const REF_RE = /Refs?:\s*(\S+)/;
const { JSDOM } = require('jsdom');

/**
 * Most of this class is ported from node-review
 */
class LinkParser {
  constructor(repo, html) {
    this.repo = repo;
    this.OP = JSDOM.fragment(html);
  }

  getFixesUrlsFromArray(arr) {
    const repo = this.repo;
    const result = [];
    for (const item of arr) {
      const m = item.match(FIX_RE);
      if (!m) continue;
      const fix = m[1];
      const url = fix.replace(/^#/, `${repo}#`).replace('#', '/issues/');
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
