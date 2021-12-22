import { listBuilds, pad } from '../ci_utils.js';

const kHealthKeys = [
  'success',
  'pending',
  'aborted',
  'failed',
  'unstable'
];

class Health {
  constructor(builds) {
    for (const key of kHealthKeys) {
      this[key] = builds[key].length;
      this.count = builds.count;
    }
  }

  // Produces a row for https://github.com/nodejs/reliability#ci-health-history
  formatAsMarkdown() {
    const { success, pending, aborted, failed, unstable, count } = this;
    const rate = `${(success / (count - pending - aborted) * 100).toFixed(2)}%`;
    // eslint-disable-next-line max-len
    let result = '| UTC Time         | RUNNING | SUCCESS | UNSTABLE | ABORTED | FAILURE | Green Rate |\n';
    // eslint-disable-next-line max-len
    result += '| ---------------- | ------- | ------- | -------- | ------- | ------- | ---------- |\n';
    const time = new Date().toISOString().slice(0, 16).replace('T', ' ');
    result += `| ${time} | ${pad(pending, 7)} | ${pad(success, 8)}|`;
    result += ` ${pad(unstable, 8)} | ${pad(aborted, 7)} | ${pad(failed, 7)} |`;
    result += ` ${pad(rate, 10)} |\n`;
    return result;
  }
}

export class HealthBuild {
  constructor(cli, request, ciType, builds) {
    this.cli = cli;
    this.request = request;
    this.type = 'health';
    this.ciType = ciType;
    this.builds = builds;
    this.name = 'health';
  }

  async getResults() {
    if (!this.builds) {
      this.builds = await listBuilds(this.cli, this.request, this.ciType);
    }
    this.health = new Health(this.builds);
  }

  formatAsJson() {
    return this.health;
  }

  formatAsMarkdown() {
    return this.health.formatAsMarkdown();
  }

  display() {
    this.cli.log(this.formatAsMarkdown());
  }
}
