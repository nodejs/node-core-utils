'use strict';

const _ = require('lodash');
const chalk = require('chalk');
const { getMachineUrl, parsePRFromURL } = require('../links');
const { FAILURE_TYPES_NAME } = require('./ci_failure_parser');
const {
  parseJobFromURL,
  CI_TYPES
} = require('./ci_type_parser');
const {
  fold,
  getHighlight,
  markdownRow
} = require('./ci_utils');

class FailureAggregator {
  constructor(cli, data) {
    this.cli = cli;
    this.health = data[0];
    this.failures = data.slice(1);
    this.aggregates = null;
  }

  aggregate() {
    const failures = this.failures;
    const groupedByReason = _.chain(failures)
      .groupBy(getHighlight)
      .toPairs()
      .sortBy(0)
      .value();
    const data = [];
    for (const item of groupedByReason) {
      const [reason, failures] = item;
      // Uncomment this and redirect stderr away to see matched highlights
      // console.log('HIGHLIGHT', reason);

      // If multiple sub builds of one PR are failed by the same reason,
      // we'll only take one of those builds, as that might be a genuine failure
      const prs = _.chain(failures)
        .uniqBy('source')
        .sortBy((f) => parseJobFromURL(f.upstream).jobid)
        .map((item) => ({ source: item.source, upstream: item.upstream }))
        .value();
      const machines = _.uniq(failures.map(f => f.builtOn));
      data.push({
        reason, type: failures[0].type, failures, prs, machines
      });
    };

    const groupedByType = _.groupBy(data, 'type');
    for (const type of Object.keys(groupedByType)) {
      groupedByType[type] =
        _.sortBy(groupedByType[type], r => 0 - (r.prs.length));
    }
    this.aggregates = groupedByType;
    return groupedByType;
  }

  formatAsMarkdown() {
    let { aggregates } = this;
    if (!aggregates) {
      aggregates = this.aggregates = this.aggregate();
    }

    const last = parseJobFromURL(this.failures[0].upstream);
    const first = parseJobFromURL(
      this.failures[this.failures.length - 1].upstream
    );
    const jobName = CI_TYPES.get(first.type).jobName;
    let output = 'Failures in ';
    output += `[${jobName}/${first.jobid}](${first.link}) to `;
    output += `[${jobName}/${last.jobid}](${last.link}) `;
    output += 'that failed more than 2 PRs\n';
    output += '(Generated with `ncu-ci ';
    output += `${process.argv.slice(2).join(' ')}\`)\n\n`;

    output += this.health.formatAsMarkdown() + '\n';

    const todo = [];
    for (const type of Object.keys(aggregates)) {
      if (aggregates[type].length === 0) {
        continue;
      }
      output += `\n### ${FAILURE_TYPES_NAME[type]}\n\n`;
      for (const item of aggregates[type]) {
        const { reason, type, prs, failures, machines } = item;
        if (prs.length < 2) { continue; }
        todo.push({ count: prs.length, reason });
        output += markdownRow('Reason', `<code>${reason}</code>`);
        output += markdownRow('-', ':-');
        output += markdownRow('Type', type);
        const source = prs.map(f => f.source);
        output += markdownRow(
          'Failed PR', `${source.length} (${source.join(', ')})`
        );
        output += markdownRow(
          'Appeared', machines.map(getMachineUrl).join(', ')
        );
        if (prs.length > 1) {
          output += markdownRow('First CI', `${prs[0].upstream}`);
        }
        output += markdownRow('Last CI', `${prs[prs.length - 1].upstream}`);
        output += '\n';
        const example = failures[0].reason;
        output += fold(
          `<a href="${failures[0].url}">Example</a>`,
          (example.length > 1024 ? example.slice(0, 1024) + '...' : example)
        );
        output += '\n\n-------\n\n';
      }
    }

    output += '### Progress\n\n';
    output += todo.map(
      ({ count, reason }) => `- [ ] \`${reason}\` (${count})`).join('\n'
    );
    return output + '\n';
  }

  display() {
    let { cli, aggregates } = this;
    if (!aggregates) {
      aggregates = this.aggregates = this.aggregate();
    }

    for (const type of Object.keys(aggregates)) {
      cli.separator(type);
      for (const item of aggregates[type]) {
        const { reason, type, prs, failures, machines } = item;
        cli.table('Reason', reason);
        cli.table('Type', type);
        const source = prs
          .map(f => {
            const parsed = parsePRFromURL(f.source);
            return parsed ? `#${parsed.prid}` : f.source;
          });
        cli.table('Failed PR', `${source.length} (${source.join(', ')})`);
        cli.table('Appeared', machines.join(', '));
        if (prs.length > 1) {
          cli.table('First CI', `${prs[0].upstream}`);
        }
        cli.table('Last CI', `${prs[prs.length - 1].upstream}`);
        cli.log('\n' + chalk.bold('Example: ') + `${failures[0].url}\n`);
        const example = failures[0].reason;
        cli.log(example.length > 512 ? example.slice(0, 512) + '...' : example);
        cli.separator();
      }
    }
  }
}

module.exports = { FailureAggregator };
