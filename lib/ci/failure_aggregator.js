import chalk from 'chalk';

import { getMachineUrl, parsePRFromURL } from '../links.js';
import CIFailureParser from './ci_failure_parser.js';
import {
  parseJobFromURL,
  CI_TYPES
} from './ci_type_parser.js';
import {
  fold,
  getHighlight,
  markdownRow
} from './ci_utils.js';

const { FAILURE_TYPES_NAME } = CIFailureParser;

function uniqBy(array, key) {
  const seen = new Set();
  return array.filter((item) => !seen.has(item[key]) && seen.add(item[key]));
}

export class FailureAggregator {
  constructor(cli, data, request) {
    this.cli = cli;
    this.request = request;
    this.health = data[0];
    this.failures = data.slice(1);
    this.aggregates = null;
  }

  /**
   * Tells whether the pull request that triggered the run also modified the
   * test that failed. Such a failure is likely caused by the change itself,
   * so it should not count as an independent flaky occurrence.
   */
  async isSelfInflicted(failure) {
    const { file, source } = failure;
    if (!file || !this.request) {
      return false;
    }

    const pr = parsePRFromURL(source);
    if (!pr) {
      return false;
    }

    const path = `test/${file}.js`;
    try {
      for await (const changed of this.request.getPullRequestFiles(pr)) {
        if (changed.filename === path) {
          return true;
        }
      }
    } catch {
      // Not being able to fetch the changed files is not fatal: keep the
      // occurrence rather than dropping it on incomplete information.
      this.cli.warn(`Could not determine the files changed by ${source}`);
    }

    return false;
  }

  async aggregate() {
    const groupedByReason = Object.groupBy(this.failures, getHighlight);
    const data = [];
    for (const reason of Object.keys(groupedByReason).sort()) {
      const failures = groupedByReason[reason];
      // Uncomment this and redirect stderr away to see matched highlights
      // console.log('HIGHLIGHT', reason);

      // If multiple sub builds of one PR are failed by the same reason,
      // we'll only take one of those builds, as that might be a genuine failure
      const candidates = uniqBy(failures, 'source');
      const selfInflicted = await Promise.all(
        candidates.map(failure => this.isSelfInflicted(failure)));
      const prs = candidates
        .filter((_, index) => !selfInflicted[index])
        .map(({ source, upstream }) => ({ source, upstream, _id: parseJobFromURL(upstream).jobid }))
        .sort((a, b) => a._id - b._id);
      const machines = uniqBy(
        failures.map(f => ({ hostname: f.builtOn, url: f.url })),
        'hostname');
      data.push({
        reason, type: failures[0].type, failures, prs, machines
      });
    }

    const groupedByType = Object.groupBy(data, ({ type }) => type);
    for (const group of Object.values(groupedByType)) {
      group.sort((a, b) => b.prs.length - a.prs.length);
    }
    this.aggregates = groupedByType;
    return groupedByType;
  }

  formatAsMarkdown() {
    const { aggregates } = this;
    if (!aggregates) {
      throw new Error('aggregate() must be awaited before formatAsMarkdown()');
    }

    const last = parseJobFromURL(this.failures[0].upstream);
    const first = parseJobFromURL(
      this.failures[this.failures.length - 1].upstream
    );
    const jobName = CI_TYPES.get(first.type).jobName;
    let output = 'Failures in ';
    output += `[${jobName}/${first.jobid}](${first.link}) to `;
    output += `[${jobName}/${last.jobid}](${last.link}) `;
    output += 'that failed 2 or more PRs\n';
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
        const source = prs.map(f => `[${f.source}](${f.upstream})`);
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
    const { cli, aggregates } = this;
    if (!aggregates) {
      throw new Error('aggregate() must be awaited before display()');
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
        cli.table('Appeared', machines.map(m => m.hostname).join(', '));
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
