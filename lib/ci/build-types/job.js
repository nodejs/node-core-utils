import qs from 'node:querystring';

import { CI_DOMAIN } from '../ci_type_parser.js';
import Cache from '../../cache.js';
import CIFailureParser from '../ci_failure_parser.js';

const {
  FAILURE_TYPES: { NCU_FAILURE },
  FAILURE_CONSTRUCTORS: {
    [NCU_FAILURE]: NCUFailure
  },
  CIResult
} = CIFailureParser;

export class Job {
  constructor(cli, request, path, tree) {
    this.cli = cli;
    this.request = request;
    this.path = path;
    this.tree = tree;
  }

  get jobUrl() {
    const { path } = this;
    return `https://${CI_DOMAIN}/${path}`;
  }

  get apiUrl() {
    const { tree, jobUrl } = this;
    const query = tree ? `?tree=${qs.escape(tree)}` : '';
    return `${jobUrl}api/json${query}`;
  }

  get consoleUrl() {
    const { path } = this;
    return `https://${CI_DOMAIN}/${path}consoleText`;
  }

  get consoleUIUrl() {
    const { path } = this;
    return `https://${CI_DOMAIN}/${path}console`;
  }

  async getBuildData(type = 'Build') {
    const { cli, path } = this;
    cli.startSpinner(`Querying data for ${path}`);
    const data = await this.getAPIData();
    cli.stopSpinner(`${type} data downloaded`);
    return data;
  }

  getCause(actions) {
    if (actions && actions.find(item => item.causes)) {
      const action = actions.find(item => item.causes);
      return action.causes[0];
    }
  }

  async getAPIData() {
    const { apiUrl, cli, request, path } = this;
    cli.updateSpinner(`Querying API for ${path}`);
    return request.json(apiUrl);
  }

  async getConsoleText() {
    const { cli, consoleUrl, request, path } = this;
    cli.updateSpinner(`Querying console text for ${path}`);
    const data = await request.text(consoleUrl);
    return data.replace(/\r/g, '');
  }

  getCacheKey() {
    return this.path
      .replace(/job\//, '')
      .replace(/\//g, '-')
      .replace(/-$/, '');
  }

  async parseConsoleText() {
    let text;
    try {
      text = await this.getConsoleText();
    } catch (err) {
      this.failures = [
        new NCUFailure({
          url: this.consoleUrl, builtOn: this.builtOn
        }, err.message)
      ];
      return this.failures;
    }

    const parser = new CIFailureParser(this, text);
    let results = parser.parse();
    if (!results) {
      results = [
        new CIResult({ url: this.jobUrl, builtOn: this.builtOn }, 'Unknown')
      ];
    }

    this.failures = results;
    return results;
  }
}

// TODO(joyeecheung): do not cache pending jobs
export const jobCache = new Cache();
jobCache.wrap(Job, {
  getConsoleText() {
    return { key: this.getCacheKey(), ext: '.txt' };
  },
  getAPIData() {
    return { key: this.getCacheKey(), ext: '.json' };
  }
});
