'use strict';

const FIXES_RE = /(Close[ds]?|Fix(e[ds])?|Resolve[sd]?)\s*:\s*(\S+)/mgi;
const FIX_RE = /(Close[ds]?|Fix(e[ds])?|Resolve[sd]?)\s*:\s*(\S+)/i;
const REFS_RE = /Refs?\s*:\s*(\S+)/mgi;
const REF_RE = /Refs?\s*:\s*(\S+)/i;
const cheerio = require('cheerio');

/**
 * Most of this class is ported from node-review
 */
class LinkParser {
  constructor(owner, repo, html) {
    this.owner = owner;
    this.repo = repo;
    this.$ = cheerio.load(html);
  }

  getFixesUrlsFromArray(arr) {
    const { owner, repo } = this;
    const result = [];
    for (const item of arr) {
      const m = item.match(FIX_RE);
      if (!m) continue;
      const fix = m[3];
      const url = fix.replace(/^#/,
        `${owner}/${repo}#`).replace('#', '/issues/');
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
    const as = this.$('a');
    const links = as.map((i, el) => this.$(el)).get();
    for (const link of links) {
      const text = link.text();
      if (text === ref) {
        const href = link.attr('href');
        if (href) return href;
      }
    }
  }

  getFixes() {
    const text = this.$.text();
    const fixes = text.match(FIXES_RE);
    if (fixes) {
      return this.getFixesUrlsFromArray(fixes);
    }
    return [];
  }

  getRefs() {
    const text = this.$.text();
    const refs = text.match(REFS_RE);
    if (refs) {
      return this.getRefsUrlsFromArray(refs);
    }
    return [];
  }
};

const GITHUB_PULL_REQUEST_URL = /github.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

LinkParser.parsePRFromURL = function(url) {
  if (typeof url !== 'string') {
    return undefined;
  }
  const match = url.match(GITHUB_PULL_REQUEST_URL);
  if (match) {
    return {
      owner: match[1],
      repo: match[2],
      prid: parseInt(match[3])
    };
  }
  return undefined;
};

LinkParser.getPrURL = function(owner, repo, prid) {
  return `https://github.com/${owner}/${repo}/pull/${prid}`;
};

const PR_URL_RE = /PR-URL: https:\/\/github.com\/.+/;
LinkParser.parsePrURL = function(text) {
  if (typeof text !== 'string') {
    return undefined;
  }
  const match = text.match(PR_URL_RE);
  if (!match) {
    return undefined;
  }
  return LinkParser.parsePRFromURL(match[0]);
};

module.exports = LinkParser;
