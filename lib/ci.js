'use strict';

// (XXX) Do we need the protocol?
const CI_RE = /https:\/\/ci\.nodejs\.org(\S+)/mg;
const CI_DOMAIN = 'ci.nodejs.org';

// constants
const CITGM = 'CITGM';
const FULL = 'FULL';
const BENCHMARK = 'BENCHMARK';
const LIBUV = 'LIBUV';
const NOINTL = 'NOINTL';
const V8 = 'V8';

const CI_TYPES = new Map([
  [CITGM, { name: 'CITGM', re: /citgm/ }],
  [FULL,
    { name: 'Full',
      re: /node-test-pull-request|node-test-commit\// }],
  [BENCHMARK, { name: 'Benchmark', re: /benchmark/ }],
  [LIBUV, { name: 'libuv', re: /libuv/ }],
  [NOINTL, { name: 'No Intl', re: /nointl/ }],
  [V8, { name: 'V8', re: /node-test-commit-v8/ }]
]);

class CIParser {
  constructor(comments) {
    this.comments = comments;
  }

  parse() {
    const comments = this.comments;
    /**
     * @type {Map<string, {link: string, date: string}>}
     */
    const result = new Map();
    for (const c of comments) {
      if (!c.bodyText.includes(CI_DOMAIN)) continue;
      const cis = this.parseText(c.bodyText);
      for (const ci of cis) {
        const entry = result.get(ci.type);
        if (!entry || entry.date < c.publishedAt) {
          result.set(ci.type, {link: ci.link, date: c.publishedAt});
        }
      }
    }
    return result;
  }

  /**
   * @param {string} text 
   */
  parseText(text) {
    const m = text.match(CI_RE);
    if (!m) {
      return [];
    }

    const result = [];
    for (const link of m) {
      for (const [type, info] of CI_TYPES) {
        if (info.re.test(link)) {
          result.push({ type, link });
          break;
        }
      }
    }

    return result;
  }
}

CIParser.TYPES = CI_TYPES;
CIParser.constants = {
  CITGM, FULL, BENCHMARK, LIBUV, V8, NOINTL
};

module.exports = CIParser;
