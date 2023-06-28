import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { env } from 'node:process';

import {
  runAsync
} from './run.js';
import Session from './session.js';
import {
  getEditor
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
      console.warn('The pull request appears to have been merged already.');
    } else if (repository.pullRequest.closed) {
      console.warn('The pull request appears to have been closed already.');
    }
    if (this.closeVote) return this.decryptKeyPart(repository.pullRequest);
    const username = (await runAsync('git', ['config', '--get', 'user.name'],
      { captureStdout: true })).trim();
    const emailAddress = (await runAsync('git', ['config', '--get', 'user.email'],
      { captureStdout: true })).trim();
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
    const subPath = `${prInfo.headRefName}/vote.yml`;
    const yamlString = await this.req.text(
        `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(subPath)}?ref=${prInfo.commits.nodes[0].commit.oid}`, {
          agent: this.req.proxyAgent,
          headers: {
            Authorization: `Basic ${this.req.credentials.github}`,
            'User-Agent': 'node-core-utils',
            Accept: 'application/vnd.github.raw'
          }
        });

    const { shares } = yaml.load(yamlString);
    const ac = new AbortController();
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

    const keyPart = out.toString('base64');
    console.log('Your key part is', keyPart);
    if (this.postComment) {
      const { html_url } = await this.req.json(`https://api.github.com/repos/${this.owner}/${this.repo}/issues/${this.prid}/comments`, {
        agent: this.req.proxyAgent,
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.req.credentials.github}`,
          'User-Agent': 'node-core-utils',
          Accept: 'application/vnd.github.antiope-preview+json'
        },
        body: JSON.stringify({
          body: 'I would like to close this vote, and for this effect, I\'m revealing my ' +
                'key part:\n\n```\n-----BEGIN SHAMIR KEY PART-----\n' +
                keyPart +
                '\n-----END SHAMIR KEY PART-----\n```\n'
        })
      });
      console.log('Comment posted at ', html_url);
    }
  }
}
