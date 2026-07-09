import auth from '../../lib/auth.js';
import { parsePRFromURL } from '../../lib/links.js';
import CLI from '../../lib/cli.js';
import Request from '../../lib/request.js';
import { runPromise } from '../../lib/run.js';
import BenchmarkSession from '../../lib/benchmark.js';

export const command = 'benchmark <identifier>';
export const describe =
  'Trigger the benchmark GitHub Actions workflow for a pull request';

const options = {
  owner: {
    alias: 'o',
    describe: 'GitHub owner of the PR repository',
    default: 'nodejs',
    type: 'string'
  },
  repo: {
    alias: 'r',
    describe: 'GitHub repository of the PR',
    default: 'node',
    type: 'string'
  },
  'workflow-owner': {
    describe: 'GitHub owner of the repository hosting the benchmark workflow ' +
      '(defaults to the PR owner)',
    type: 'string'
  },
  'workflow-repo': {
    describe: 'GitHub repository hosting the benchmark workflow ' +
      '(defaults to the PR repository)',
    type: 'string'
  },
  workflow: {
    describe: 'The workflow file to dispatch',
    default: 'benchmark.yml',
    type: 'string'
  },
  ref: {
    describe: 'The git ref of the workflow repository to run the workflow from',
    default: 'main',
    type: 'string'
  },
  runs: {
    describe: 'How many times to repeat each benchmark',
    type: 'number'
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs
    .options(options)
    .positional('identifier', {
      type: 'string',
      describe: 'ID or URL of the pull request. A commit URL ' +
        '(…/pull/<id>/commits/<sha>) benchmarks that commit instead of the ' +
        'PR head.'
    })
    .example('git node benchmark 12344',
      'Pick benchmark categories to run on ' +
      'https://github.com/nodejs/node/pull/12344')
    .example('git node benchmark https://github.com/nodejs/node/pull/12344',
      'Pick benchmark categories to run on ' +
      'https://github.com/nodejs/node/pull/12344')
    .example(
      'git node benchmark ' +
      'https://github.com/nodejs/node/pull/12344/commits/abc1234',
      'Benchmark commit abc1234 rather than the current PR head')
    .wrap(90);
}

const COMMIT_URL_RE = /\/pull\/\d+\/commits\/([0-9a-f]{7,40})/i;

// Parse the positional identifier into { prid, owner?, repo?, commit? }.
// A PR commit URL (…/pull/<id>/commits/<sha>) also yields the commit SHA.
export function parseIdentifier(identifier) {
  const prid = Number.parseInt(identifier);
  if (!Number.isNaN(prid)) {
    return { prid };
  }
  const parsed = parsePRFromURL(identifier);
  if (!parsed) {
    return undefined;
  }
  const commit = COMMIT_URL_RE.exec(identifier);
  if (commit) {
    parsed.commit = commit[1];
  }
  return parsed;
}

export function handler(argv) {
  const parsed = parseIdentifier(argv.identifier);
  if (!parsed) {
    return yargsInstance.showHelp();
  }
  Object.assign(argv, parsed);

  return runPromise(main(argv));
}

async function main(argv) {
  const cli = new CLI(process.stderr);
  const credentials = await auth({ github: true });
  const request = new Request(credentials);
  const session = new BenchmarkSession(cli, request, argv);
  return session.start();
}
