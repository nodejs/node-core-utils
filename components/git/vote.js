import auth from '../../lib/auth.js';
import { parsePRFromURL } from '../../lib/links.js';
import CLI from '../../lib/cli.js';
import Request from '../../lib/request.js';
import { runPromise } from '../../lib/run.js';
import VotingSession from '../../lib/voting_session.js';

export const command = 'vote [prid|options]';
export const describe =
  'Cast a vote, or decrypt a key part to close a vote';

const voteOptions = {
  abstain: {
    type: 'boolean',
    default: false,
    describe: 'Abstain from the vote.'
  },
  'decrypt-key-part': {
    describe: 'Publish a key part as a comment to the vote PR.',
    default: false,
    type: 'boolean'
  },
  'gpg-sign': {
    describe: 'GPG-sign commits, will be passed to the git process',
    alias: 'S'
  },
  'post-comment': {
    describe: 'Post the comment on GitHub on the behalf of the user',
    default: false,
    type: 'boolean'
  },
  protocol: {
    describe: 'The protocol to use to clone the vote repository and push the eventual vote commit',
    type: 'string'
  }
};

let yargsInstance;

export function builder(yargs) {
  yargsInstance = yargs;
  return yargs
    .options(voteOptions)
    .positional('prid', {
      describe: 'URL of the vote Pull Request'
    })
    .example('git node vote https://github.com/nodejs/TSC/pull/12344',
      'Start an interactive session to cast ballot for https://github.com/nodejs/TSC/pull/12344.')
    .example('git node vote https://github.com/nodejs/TSC/pull/12344 --abstain',
      'Cast an empty ballot for https://github.com/nodejs/TSC/pull/12344.')
    .example('git node vote https://github.com/nodejs/TSC/pull/12344 --decrypt-key-part',
      'Uses gpg to decrypt a key part to close the vote happening on https://github.com/nodejs/TSC/pull/12344.');
}

export function handler(argv) {
  if (argv.prid) {
    const parsed = parsePRFromURL(argv.prid);
    if (parsed) {
      Object.assign(argv, parsed);
      return vote(argv);
    }
  }
  yargsInstance.showHelp();
}

function vote(argv) {
  const cli = new CLI(process.stderr);
  const dir = process.cwd();

  return runPromise(main(argv, cli, dir)).catch((err) => {
    if (cli.spinner.enabled) {
      cli.spinner.fail();
    }
    throw err;
  });
}

async function main(argv, cli, dir) {
  const credentials = await auth({ github: true });
  const req = new Request(credentials);
  const session = new VotingSession(cli, req, dir, argv);

  return session.start();
}
