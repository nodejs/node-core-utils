import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { env } from 'node:process';

import {
  runAsync
} from './run.js';
import Session from './session.js';
import {
  getEditor, isGhAvailable
} from './utils.js';

import voteUsingGit from '@node-core/caritat/voteUsingGit';
import * as yaml from 'js-yaml';

function getHTTPRepoURL(repoURL, login) {
  const url = new URL(repoURL + '.git');
  url.username = login;
  return url.toString();
}

export default class VotingSession extends Session {
  constructor(cli, req, dir, {
    prid, abstain, ...argv
  } = {}) {
    super(cli, dir, prid, argv, false);
    this.req = req;
    this.abstain = abstain;
    this.closeVote = argv['decrypt-key-part'];
    this.postComment = argv['post-comment'];
    this.gpgSign = argv['gpg-sign'];
  }

  get argv() {
    const args = super.argv;
    args.decryptKeyPart = this.closeVote;
    return args;
  }

  async start(metadata) {
    const { repository, viewer } = await this.req.gql('VotePRInfo',
      { owner: this.owner, repo: this.repo, prid: this.prid });
    if (repository.pullRequest.merged) {
      this.cli.warn('The pull request appears to have been merged already.');
    } else if (repository.pullRequest.closed) {
      this.cli.warn('The pull request appears to have been closed already.');
    }
    if (this.closeVote) return this.decryptKeyPart(repository.pullRequest);
    // @see https://git-scm.com/book/en/v2/Git-Internals-Environment-Variables#_committing
    const username = process.env.GIT_AUTHOR_NAME || (await runAsync(
      'git', ['config', '--get', 'user.name'], { captureStdout: true })).trim();
    const emailAddress = process.env.GIT_AUTHOR_EMAIL || (await runAsync(
      'git', ['config', '--get', 'user.email'], { captureStdout: true })).trim();
    const { headRef } = repository.pullRequest;
    await voteUsingGit({
      GIT_BIN: 'git',
      abstain: this.abstain,
      EDITOR: await getEditor({ git: true }),
      handle: viewer.login,
      username,
      emailAddress,
      gpgSign: this.gpgSign,
      repoURL: viewer.publicKeys.totalCount
        ? headRef.repository.sshUrl
        : getHTTPRepoURL(headRef.repository.url, viewer.login),
      branch: headRef.name,
      subPath: headRef.name
    });
  }

  async decryptKeyPart(prInfo) {
    const subPath = `${prInfo.headRef.name}/vote.yml`;
    this.cli.startSpinner('Downloading vote file from remote...');
    const yamlString = await this.req.text(
        `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(subPath)}?ref=${prInfo.commits.nodes[0].commit.oid}`, {
          agent: this.req.proxyAgent,
          headers: {
            Authorization: `Basic ${this.req.credentials.github}`,
            'User-Agent': 'node-core-utils',
            Accept: 'application/vnd.github.raw'
          }
        });
    this.cli.stopSpinner('Download complete');

    const { shares } = yaml.load(yamlString);
    const ac = new AbortController();
    this.cli.startSpinner('Decrypt key part...');
    const out = await Promise.any(
      shares.map(async(share) => {
        const cp = spawn(env.GPG_BIN || 'gpg', ['-d'], {
          stdio: ['pipe', 'pipe', 'inherit'],
          signal: ac.signal
        });
        // @ts-ignore toArray exists
        const stdout = cp.stdout.toArray();
        stdout.catch(Function.prototype); // ignore errors.
        cp.stdin.end(share);
        const [code] = await Promise.race([
          once(cp, 'exit'),
          once(cp, 'error').then((er) => Promise.reject(er))
        ]);
        if (code !== 0) throw new Error('failed', { cause: code });
        return Buffer.concat(await stdout);
      })
    );
    ac.abort();
    this.cli.stopSpinner('Found one key part.');

    const keyPart = '-----BEGIN SHAMIR KEY PART-----\n' +
                    out.toString('base64') +
                    '\n-----END SHAMIR KEY PART-----';
    this.cli.log('Your key part is:');
    this.cli.log(keyPart);
    const body = 'I would like to close this vote, and for this effect, I\'m revealing my ' +
                 `key part:\n\n${'```'}\n${keyPart}\n${'```'}\n`;
    if (this.postComment) {
      const { message, html_url } = await this.req.json(`https://api.github.com/repos/${this.owner}/${this.repo}/issues/${this.prid}/comments`, {
        agent: this.req.proxyAgent,
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.req.credentials.github}`,
          'User-Agent': 'node-core-utils',
          Accept: 'application/vnd.github.antiope-preview+json'
        },
        body: JSON.stringify({ body })
      });
      if (html_url) {
        this.cli.log(`Comment posted at: ${html_url}`);
        return;
      } else {
        this.cli.warn(message);
        this.cli.error('Failed to post comment');
      }
    }
    if (isGhAvailable()) {
      this.cli.log('\nRun the following command to post the comment:\n');
      this.cli.log(
        `gh pr comment ${this.prid} --repo ${this.owner}/${this.repo} ` +
        `--body-file - <<'EOF'\n${body}\nEOF`
      );
    } else {
      this.cli.log('\nPost the following comment on the PR thread:\n');
      this.cli.log(body);
    }
  }
}
