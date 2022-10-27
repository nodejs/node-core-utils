#!/usr/bin/env node

import yargs from 'yargs';
import clipboardy from 'clipboardy';

import {
  JobParser,
  parseJobFromURL,
  CI_TYPES_KEYS
} from '../lib/ci/ci_type_parser.js';
import { setVerbosityFromEnv } from '../lib/verbosity.js';
import { listBuilds } from '../lib/ci/ci_utils.js';
import { jobCache } from '../lib/ci/build-types/job.js';
import { PRBuild } from '../lib/ci/build-types/pr_build.js';
import { CommitBuild } from '../lib/ci/build-types/commit_build.js';
import { DailyBuild } from '../lib/ci/build-types/daily_build.js';
import { FailureAggregator } from '../lib/ci/failure_aggregator.js';
import { BenchmarkRun } from '../lib/ci/build-types/benchmark_run.js';
import { HealthBuild } from '../lib/ci/build-types/health_build.js';
import { CITGMBuild } from '../lib/ci/build-types/citgm_build.js';
import {
  CITGMComparisonBuild
} from '../lib/ci/build-types/citgm_comparison_build.js';
import {
  RunPRJob
} from '../lib/ci/run_ci.js';
import { writeJson, writeFile } from '../lib/file.js';
import { getMergedConfig } from '../lib/config.js';
import { runPromise } from '../lib/run.js';
import auth from '../lib/auth.js';
import Request from '../lib/request.js';
import CLI from '../lib/cli.js';
import { hideBin } from 'yargs/helpers';

setVerbosityFromEnv();

const {
  PR,
  COMMIT,
  BENCHMARK,
  CITGM,
  CITGM_NOBUILD,
  DAILY_MASTER
} = CI_TYPES_KEYS;

const commandKeys = [
  'rate',
  'walk',
  'url',
  'pr',
  'commit',
  'citgm'
];

const args = yargs(hideBin(process.argv))
  .command({
    command: 'rate <type>',
    desc: 'Calculate the green rate of a CI job in the last 100 runs',
    builder: (yargs) => {
      yargs
        .positional('type', {
          describe: 'type of CI',
          choices: ['commit', 'pr']
        });
    },
    handler
  })
  .command({
    command: 'walk <type>',
    desc: 'Walk the CI and display the failures',
    builder: (yargs) => {
      yargs
        .positional('type', {
          describe: 'type of CI',
          choices: ['commit', 'pr']
        })
        .option('stats', {
          default: false,
          describe: 'Aggregate the results'
        })
        .option('cache', {
          default: false,
          describe: 'Cache the responses from Jenkins in .ncu/cache/ under' +
                    ' the node-core-utils installation directory'
        })
        .option('limit', {
          default: 99,
          describe: 'Maximum number of CIs to get data from'
        })
        .option('since <date>', {
          type: 'string',
          describe: 'Time since when the CI results should be queried'
        }).check(argv => {
          try {
            // eslint-disable-next-line no-new
            new Date(argv.since);
          } catch {
            throw new Error('--since <date> should be string that can ' +
                            'be parsed by new Date()');
          }
          return true;
        });
    },
    handler
  })
  .command({
    command: 'run <prid>',
    desc: 'Run CI for given PR',
    builder: (yargs) => {
      yargs
        .positional('prid', {
          describe: 'ID of the PR',
          type: 'number'
        })
        .option('owner', {
          default: '',
          describe: 'GitHub repository owner'
        })
        .option('repo', {
          default: '',
          describe: 'GitHub repository name'
        });
    },
    handler
  })
  .command({
    command: 'url <url>',
    desc: 'Automatically detect CI type and show results',
    builder: (yargs) => {
      yargs
        .positional('url', {
          describe: 'URL of the PR or the CI',
          type: 'string'
        });
    },
    handler
  })
  .command({
    command: 'pr <jobid>',
    desc: 'Show results of a node-test-pull-request CI job',
    builder: (yargs) => {
      yargs
        .positional('jobid', {
          describe: 'id of the job',
          type: 'number'
        });
    },
    handler
  })
  .command({
    command: 'commit <jobid>',
    desc: 'Show results of a node-test-commit CI job',
    builder: (yargs) => {
      yargs
        .positional('jobid', {
          describe: 'id of the first job',
          type: 'number'
        });
    },
    handler
  })
  .command({
    command: 'benchmark <jobid>',
    desc: 'Show results of a benchmark-node-micro-benchmarks CI job',
    builder: (yargs) => {
      yargs
        .positional('jobid', {
          describe: 'id of the job',
          type: 'number'
        });
    },
    handler
  })
  .command({
    command: 'citgm <jobid> [jobid2]',
    desc: 'Show results of a citgm-smoker CI job',
    builder: (yargs) => {
      yargs
        .positional('jobid', {
          describe: 'id of the job',
          type: 'number'
        })
        .positional('jobid2', {
          describe: 'id of the second job, if doing a comparison',
          type: 'number'
        });
    },
    handler
  })
  .command({
    command: 'daily',
    desc: 'Show recent results of node-daily-master',
    builder: (yargs) => {
      yargs
        .option('stats', {
          default: false,
          describe: 'Aggregate the results'
        })
        .option('cache', {
          default: false,
          describe: 'Cache the responses from Jenkins in .ncu/cache/ under' +
                    ' the node-core-utils installation directory'
        })
        .option('limit', {
          default: 15,
          describe: 'Maximum number of CIs to get data from'
        });
    },
    handler
  })
  .demandCommand(1, 'must provide a valid command')
  .option('copy', {
    describe: 'Write the results as markdown to clipboard',
    default: false,
    type: 'boolean'
  })
  .option('nobuild', {
    describe: 'If running cigtm, whether or not jobid is citgm-nobuild.',
    type: 'boolean',
    default: false
  })
  .option('json <path>', {
    type: 'string',
    describe: 'Write the results as json to <path>'
  })
  .option('markdown <path>', {
    type: 'string',
    describe: 'Write the results as markdown to <path>'
  }).check(argv => {
    if (argv.markdown && commandKeys.includes(argv.markdown)) {
      throw new Error('--markdown <path> did not specify a valid path');
    } else if (argv.json && commandKeys.includes(argv.json)) {
      throw new Error('--json <path> did not specify a valid path');
    }
    return true;
  })
  .help();

args.parse();

const commandToType = {
  commit: COMMIT,
  pr: PR,
  benchmark: BENCHMARK,
  citgm: CITGM
};

class RunPRJobCommand {
  constructor(cli, request, argv) {
    this.cli = cli;
    this.request = request;
    this.dir = process.cwd();
    this.argv = argv;
    this.config = getMergedConfig(this.dir);
  }

  get owner() {
    return this.argv.owner || this.config.owner;
  }

  get repo() {
    return this.argv.repo || this.config.repo;
  }

  get prid() {
    return this.argv.prid;
  }

  async start() {
    const {
      cli, request, prid, repo, owner
    } = this;
    let validArgs = true;
    if (!repo) {
      validArgs = false;
      cli.error('GitHub repository is missing, please set it via ncu-config ' +
                'or pass it via the --repo option');
    }
    if (!owner) {
      cli.error('GitHub owner is missing, please set it via ncu-config ' +
                'or pass it via the --owner option');
      validArgs = false;
    }
    if (!validArgs) {
      this.cli.setExitCode(1);
      return;
    }
    const jobRunner = new RunPRJob(cli, request, owner, repo, prid);
    if (!(await jobRunner.start())) {
      this.cli.setExitCode(1);
      process.exitCode = 1;
    }
  }
}

class CICommand {
  constructor(cli, request, argv) {
    this.cli = cli;
    this.request = request;
    this.argv = argv;
    this.queue = [];
    this.json = [];
    this.markdown = '';
  }

  async drain() {
    if (this.queue.length === 0) {
      return;
    }

    const { cli, queue, argv, request } = this;

    for (let i = 0; i < queue.length; ++i) {
      const job = queue[i];
      cli.separator('');
      const progress = `[${i + 1}/${queue.length}]`;
      if (job.link) {
        cli.log(`${progress} Running ${job.link}`);
      } else if (job.jobid) {
        cli.log(`${progress} Running ${job.type}: ${job.jobid}`);
      } else {
        cli.log(`${progress} Running ${job.type}`);
      }
      cli.separator('');

      let build;
      switch (job.type) {
        case 'health':
          build = new HealthBuild(cli, request, job.ciType, job.builds);
          break;
        case PR:
          build = new PRBuild(cli, request, job.jobid);
          break;
        case COMMIT:
          build = new CommitBuild(cli, request, job.jobid);
          break;
        case CITGM:
        case CITGM_NOBUILD:
          if (job.jobid2) {
            build = new CITGMComparisonBuild(cli, request, job);
          } else {
            build = new CITGMBuild(cli, request, job);
          }
          break;
        case BENCHMARK:
          build = new BenchmarkRun(cli, request, job.jobid);
          break;
        case DAILY_MASTER: {
          const daily = new DailyBuild(cli, request, job.jobid);
          const data = await daily.getBuildData();
          const testCommitBuild = data.subBuilds.filter(subBuild => {
            return subBuild.jobName === 'node-test-commit';
          })[0];
          if (testCommitBuild) {
            build = new CommitBuild(cli, request, testCommitBuild.buildNumber);
            break;
          } else {
            throw new Error('Could not find \'node-test-commit\' job');
          }
        }
        default:
          throw new Error(`Unknown job type ${job.type}`);
      }

      await build.getResults();
      build.display();

      // Set this.json regardless of whether the user has passed
      // --json - it's needed for failure aggregation.
      const json = build.formatAsJson();
      if (json !== undefined) {
        this.json = this.json.concat(json);
      }

      if ((argv.copy || argv.markdown) && !argv.stats) {
        this.markdown += build.formatAsMarkdown();
      }
    }
  }

  async aggregate() {}  // noop

  async serialize() {
    const { argv, cli } = this;

    if (argv.copy) {
      if (this.markdown) {
        clipboardy.writeSync(this.markdown);
        cli.separator('');
        cli.log('Written markdown to clipboard');
      } else {
        cli.error('No markdown generated');
      }
    }

    if (argv.markdown) {
      if (this.markdown) {
        writeFile(argv.markdown, this.markdown);
        cli.separator('');
        cli.log(`Written markdown to ${argv.markdown}`);
      } else {
        cli.error('No markdown generated');
      }
    }

    if (argv.json) {
      if (this.json.length) {
        writeJson(argv.json, this.json);
        cli.separator('');
        cli.log(`Wrote JSON to ${argv.json}`);
      } else {
        cli.error('No JSON generated');
      }
    }
  }
}

class RateCommand extends CICommand {
  async initialize() {
    this.queue.push({
      type: 'health',
      ciType: commandToType[this.argv.type]
    });
  }
}

class WalkCommand extends CICommand {
  constructor(cli, request, argv) {
    super(cli, request, argv);
    if (argv.cache) {
      jobCache.enable();
    }
  }

  async initialize() {
    const ciType = commandToType[this.argv.type];
    const since = this.argv.since ? new Date(this.argv.since) : undefined;
    const builds = await listBuilds(this.cli, this.request, ciType, since);
    if (builds.count === 0) {
      this.cli.log('No applicable builds found.');
      return;
    }
    this.queue.push({ type: 'health', ciType, builds });
    for (const build of builds.failed.slice(0, this.argv.limit)) {
      this.queue.push(build);
    }
  }

  async aggregate() {
    const { argv, cli } = this;
    if (this.queue.length === 0) {
      return;
    }
    const aggregator = new FailureAggregator(cli, this.json);
    this.json = aggregator.aggregate();
    cli.log('');
    cli.separator('Stats');
    cli.log('');
    aggregator.display();

    if (argv.markdown || argv.copy) {
      this.markdown = aggregator.formatAsMarkdown();
    }
  }
}

class JobCommand extends CICommand {
  constructor(cli, request, argv, command) {
    super(cli, request, argv);
    this.command = command;
  }

  async initialize() {
    const { queue, argv } = this;

    queue.push({
      type: commandToType[this.command],
      jobid: argv.jobid,
      jobid2: argv.jobid2,
      noBuild: this.argv.nobuild
    });
  }
}

class URLCommand extends CICommand {
  async initialize() {
    const { argv, cli, request, queue } = this;
    const parsed = parseJobFromURL(argv.url);
    if (parsed) {
      queue.push({
        type: parsed.type,
        jobid: parsed.jobid
      });
      return;
    }

    // Parse CI links from PR.
    const parser = await JobParser.fromPR(argv.url, cli, request);
    if (!parser) {  // Not a valid PR URL
      cli.error(`${argv.url} is not a valid PR URL`);
      return;
    }
    const ciMap = parser.parse();
    if (ciMap.size === 0) {
      cli.info(`No CI run detected from ${argv.url}`);
    }
    for (const [type, ci] of ciMap) {
      queue.push({
        type,
        jobid: ci.jobid
      });
    }
  }
}

class DailyCommand extends CICommand {
  constructor(cli, request, argv) {
    super(cli, request, argv);
    if (argv.cache) {
      jobCache.enable();
    }
  }

  async initialize() {
    const ciType = DAILY_MASTER;
    const builds = await listBuilds(this.cli, this.request, ciType);
    this.queue.push({ type: 'health', ciType, builds });
    for (const build of builds.failed.slice(0, this.argv.limit)) {
      this.queue.push(build);
    }
  }

  async aggregate() {
    const { argv, cli } = this;
    const aggregator = new FailureAggregator(cli, this.json);
    this.json = aggregator.aggregate();
    cli.log('');
    cli.separator('Stats');
    cli.log('');
    aggregator.display();

    if (argv.markdown || argv.copy) {
      this.markdown = aggregator.formatAsMarkdown();
    }
  }
}

async function main(command, argv) {
  const cli = new CLI();
  const credentials = await auth({
    github: true,
    jenkins: true
  });
  const request = new Request(credentials);

  let commandHandler;
  // Prepare queue.
  switch (command) {
    case 'run': {
      const jobRunner = new RunPRJobCommand(cli, request, argv);
      return jobRunner.start();
    }
    case 'rate': {
      commandHandler = new RateCommand(cli, request, argv);
      break;
    }
    case 'walk': {
      commandHandler = new WalkCommand(cli, request, argv);
      break;
    }
    case 'url': {
      commandHandler = new URLCommand(cli, request, argv);
      break;
    }
    case 'pr':
    case 'commit':
    case 'citgm':
    case 'benchmark': {
      commandHandler = new JobCommand(cli, request, argv, command);
      break;
    }
    case 'daily': {
      commandHandler = new DailyCommand(cli, request, argv, command);
      break;
    }
    default:
      return args.showHelp();
  }

  await commandHandler.initialize();
  await commandHandler.drain();
  await commandHandler.aggregate();
  await commandHandler.serialize();
}

function handler(argv) {
  const [command] = argv._;
  runPromise(main(command, argv));
}
