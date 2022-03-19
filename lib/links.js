import cheerio from 'cheerio';

const FIXES_RE = /(Close[ds]?|Fix(e[ds])?|Resolve[sd]?)\s*:\s*(\S+)/mgi;
const FIX_RE = /(Close[ds]?|Fix(e[ds])?|Resolve[sd]?)\s*:\s*(\S+)/i;
const REFS_RE = /Refs?\s*:\s*(\S+)/mgi;
const REF_RE = /Refs?\s*:\s*(\S+)/i;
const PR_RE = /PR-URL\s*:\s*(\S+)/i;

/**
 * Most of this class is ported from node-review
 */
export class LinkParser {
  constructor(owner, repo, html) {
    this.owner = owner;
    this.repo = repo;
    this.$ = cheerio.load(html);
  }

  getFixesUrlsFromArray(arr) {
    const result = new Set();
    for (const item of arr) {
      const m = item.match(FIX_RE);
      if (!m) continue;
      const ref = m[3];
      const url = this.getUrlFromOP(ref);
      if (url) result.add(url);
    }
    return Array.from(result);
  }

  getRefsUrlsFromArray(arr) {
    const result = new Set();
    for (const item of arr) {
      const m = item.match(REF_RE);
      if (!m) continue;
      const ref = m[1];
      const url = this.getUrlFromOP(ref);
      if (url) result.add(url);
    }
    return Array.from(result);
  }

  getPRUrlsFromArray(arr) {
    const result = new Set();
    for (const item of arr) {
      const m = item.match(PR_RE);
      if (!m) continue;
      const prUrl = m[1];
      const url = this.getUrlFromOP(prUrl);
      if (url) result.add(url);
    }
    return Array.from(result);
  }

  // Do this so we can reliably get the correct url.
  // Otherwise, the number could reference a PR or an issue.
  getUrlFromOP(ref) {
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
    const fixes = text.match(FIXES_RE) || [];
    return this.getFixesUrlsFromArray(fixes);
  }

  getRefs() {
    const text = this.$.text();
    const refs = text.match(REFS_RE) || [];
    return this.getRefsUrlsFromArray(refs);
  }

  getAltPrUrl() {
    const text = this.$.text();
    const refs = text.match(PR_RE) || [];
    return this.getPRUrlsFromArray(refs);
  }
}

const GITHUB_PULL_REQUEST_URL = /github.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export function parsePRFromURL(url) {
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

export function getPrURL({ owner, repo, prid }) {
  return `https://github.com/${owner}/${repo}/pull/${prid}`;
};

export function getMachineUrl(name) {
  return `[${name}](https://ci.nodejs.org/computer/${name}/)`;
};

const PR_URL_RE = /PR-URL: https:\/\/github.com\/.+/;
export function parsePrURL(text) {
  if (typeof text !== 'string') {
    return undefined;
  }
  const match = text.match(PR_URL_RE);
  if (!match) {
    return undefined;
  }
  return parsePRFromURL(match[0]);
};
