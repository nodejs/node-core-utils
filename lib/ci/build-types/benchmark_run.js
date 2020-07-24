'use strict';

const { Job } = require('./job');
const { fold } = require('../ci_utils');

class BenchmarkRun extends Job {
  constructor(cli, request, id) {
    const path = `job/benchmark-node-micro-benchmarks/${id}/`;
    super(cli, request, path);

    this.results = '';
    this.significantResults = '';
  }

  async getResults() {
    const { path, cli } = this;
    cli.startSpinner(`Querying results of ${path}`);
    const text = await this.getConsoleText();
    const index = text.indexOf('improvement');
    if (index === -1) {
      throw new Error('Not finished');
    }
    const breakIndex = text.lastIndexOf('\n', index);
    const results = text.slice(breakIndex + 1)
      .replace(/\nSending e-mails[\s\S]+/mg, '');
    this.results = results;
    cli.stopSpinner('Data downloaded');
    this.significantResults = this.getSignificantResults(results);
    return results;
  }

  getSignificantResults(data) {
    const lines = data.split('\n');
    const significant = lines.filter(line => line.indexOf('*') !== -1);
    return significant.slice(0, -3).join('\n');
  }

  display() {
    const { cli, results, significantResults } = this;
    cli.log(results);
    cli.separator('significant results');
    cli.log(significantResults);
  }

  formatAsMarkdown() {
    const { results, significantResults } = this;
    const output = (fold('Benchmark results', results) + '\n\n' +
                    fold('Significant impact', significantResults) + '\n');
    return output;
  }

  formatAsJson() {
    const results = this.significantResults.split('\n').slice(1);
    const json = [];
    for (const line of results) {
      const star = line.indexOf('*');
      const name = line.slice(0, star).trim();
      const [file, ...config] = name.split(' ');
      const confidence = line.match(/(\*+)/)[1];
      const lastStar = line.lastIndexOf('*');
      const [improvement, ...accuracy] =
        line.slice(lastStar + 1).split(/\s*%/).map(i => i.trim() + '%');
      accuracy.pop(); // remove the last empty item
      json.push({
        file,
        config,
        confidence,
        improvement,
        accuracy
      });
    }
    return json;
  }
}

module.exports = { BenchmarkRun };
