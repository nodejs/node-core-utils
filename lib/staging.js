import fs from 'node:fs';
import semver from 'semver';
import path from 'node:path';
import { getNcuDir } from './config.js';
import { readFile, readJson, writeFile, writeJson } from './file.js';
import Session from './session.js';
import { forceRunAsync, runSync } from './run.js';
const isWindows = process.platform === 'win32';

const validateNumber = (n) => !Number.isNaN(n) && n > -1 && n < Infinity;

export class Staging extends Session {
  #isLTS = undefined;

  constructor({ cli, dir, paginate, releaseLine, reporter, skipGH }) {
    super(cli, dir);
    if (!this.config.branch) {
      this.warnForMissing();
    }

    this.cli = cli;
    this.dir = dir;
    this.paginate = paginate;
    this.skipGH = skipGH;
    this.releaseLine = releaseLine;
    this.reporter = reporter;
    this.seenRequestBackportIds = new Set();
  }

  get isLTS() {
    if (this.#isLTS !== undefined) {
      return this.#isLTS;
    }
    const header = readFile(path.resolve(this.dir, 'src', 'node_version.h'));
    this.#isLTS = header.indexOf('#define NODE_VERSION_IS_LTS 1') > -1;
    return this.isLTS;
  }

  get ncuDir() {
    return getNcuDir(this.dir);
  }

  get stateDir() {
    return path.resolve(this.ncuDir, 'staging');
  }

  get branchDiffCache() {
    return path.resolve(this.ncuDir, 'branch-diff-output' + this.stagingBranch);
  }

  get state() {
    return readJson(this.stateDir);
  }

  set state(obj) {
    writeJson(this.stateDir, obj);
  }

  // If the release line is not yet set, tries to retrieve it from the
  // current ncu set branch, if that fails to work, prompt the user to set it
  async maybeSetReleaseLine() {
    if (!this.releaseLine || !validateNumber(parseInt(this.releaseLine, 10))) {
      const majorVersion = this.config.branch.split('.x-staging')[0].slice(1);
      if (!majorVersion || !validateNumber(parseInt(majorVersion, 10))) {
        const promptReleaseLine = await this.cli.prompt(
          'Enter the major version for the target release line:',
          { questionType: 'input', noSeparator: true, defaultAnswer: '' }
        );

        if (!promptReleaseLine || !validateNumber(parseInt(promptReleaseLine, 10))) {
          this.cli.error('A release line is required to port commits to.');
          return;
        } else {
          this.#setReleaseLine(promptReleaseLine);
        }
      }
      this.#setReleaseLine(majorVersion);
    }
  }

  async getBranchDiff() {
    const cli = this.cli;
    const upstream = this.config.upstream;
    const majorVersion = this.releaseLine;

    const excludeLabels = [
      'semver-major',
      `dont-land-on-v${majorVersion}.x`,
      `backport-requested-v${majorVersion}.x`,
      `backported-to-v${majorVersion}.x`,
      `backport-blocked-v${majorVersion}.x`,
      `backport-open-v${majorVersion}.x`
    ];

    let comparisonBranch;
    if (this.isLTS) {
      excludeLabels.push('baking-for-lts');
      const res = await fetch('https://nodejs.org/dist/index.json');
      if (!res.ok) throw new Error('Failed to fetch', { cause: res });
      const [latest] = await res.json();
      // Assume Current branch matches tag with highest semver value.
      const latestReleaseLine = semver.coerce(latest.version).major;
      if (!validateNumber(latestReleaseLine)) {
        throw new Error('Could not determine latest release line');
      }
      comparisonBranch = `v${latestReleaseLine}.x`;
    } else {
      comparisonBranch = 'main';
    }

    await forceRunAsync('git', ['fetch', upstream, comparisonBranch], { ignoreFailures: false });
    const commits = await forceRunAsync('git', ['rev-parse', 'FETCH_HEAD', comparisonBranch], {
      captureStdout: 'lines',
      ignoreFailures: true
    });
    if (commits == null) {
      throw new Error(
        'Could not find a comparison branch. Please verify that you have\n' +
        'the correct upstream set and your local git repo is up to date.');
    } else if (commits[0] !== commits[1]) {
      const shouldUpBranch = cli.prompt(`Local ${comparisonBranch} branch is not in sync with ${
                                      upstream}/${comparisonBranch}, do you want to update it?`);
      if (shouldUpBranch) {
        await forceRunAsync('git', ['branch', '-f', comparisonBranch, 'FETCH_HEAD'], {
          ignoreFailures: false
        });
      }
    }

    const branchDiff = new URL(
      '../node_modules/.bin/branch-diff' + (isWindows ? '.cmd' : ''),
      import.meta.url
    );

    const branchDiffOptions = [
      this.stagingBranch,
      comparisonBranch,
      `--exclude-label=${excludeLabels.join(',')}`,
      '--filter-release',
      '--format=sha',
      '--reverse'
    ];
    return runSync(branchDiff, branchDiffOptions);
  }

  #setReleaseLine(releaseLine) {
    this.releaseLine = releaseLine;
    this.currentRelease = `v${releaseLine}.x`;
    this.stagingBranch = `v${releaseLine}.x-staging`;
    this.backportRequestedLabel = `backport-requested-v${releaseLine}.x`;
  }

  #backportRequestMsg() {
    return 'This commit does not land cleanly on `' +
      this.stagingBranch +
      '` and will need manual backport in case we want it in **' +
      this.currentRelease + '**.';
  }

  #getFullCommitSha(body) {
    const commitTitleRegex = /^commit (?<sha>[0-9a-f]{40})/m;
    const re = body.match(commitTitleRegex);
    if (re && re.groups) {
      return re.groups.sha;
    }
  }

  #getCommitTitle(body) {
    const commitTitleRegex = /^[ \t]+(?<title>(Revert )?\w*\S*:.*$)/m;
    const re = body.match(commitTitleRegex);
    if (re && re.groups) {
      return re.groups.title;
    }
  }

  #getCommitPRUrl(body) {
    const commitPRUrlRegex = /^.*(PR-URL:).?(?<url>.*)/im;
    const re = body.match(commitPRUrlRegex);
    if (re && re.groups) {
      return re.groups.url;
    }
  }

  #markdownReport(result) {
    const { success, errors } = result;
    const mkdownItem = (arr) => arr.map(
      ({ fullSha, sha, title, url, labels }) => {
        const s = fullSha
          ? `[\`${sha}\`](https://github.com/nodejs/node/commit/${fullSha})`
          : `\`${sha}\``;
        return `* ${s} ` +
        `[${title}](${url}) ` +
        `${labels.map(i => '`' + i + '`').join(', ')}`;
      }).join('\n');

    return `# Cherry-pick Report
## ${success.length} successfully cherry-picked commits:
${mkdownItem(success)}
## ${errors.length} commits that failed to cherry-pick:
${mkdownItem(errors)}
`;
  }

  // Use the GitHub CLI `gh` to automatically request a backport to a PR
  // by setting the appropriate label and adding a comment.
  async #requestBackport(id, comment = false) {
    if (this.skipGH || this.seenRequestBackportIds.has(id)) {
      return;
    }
    this.seenRequestBackportIds.add(id);

    if (comment) {
      try {
        await forceRunAsync('gh', ['pr', 'comment', id, '--body', this.#backportRequestMsg()],
          { captureStdout: true, captureStderr: true, ignoreFailure: false });
      } catch (err) {
        return { id, error: err.stderr };
      }
    }
    try {
      await forceRunAsync('gh', ['pr', 'edit', id, '--add-label', this.backportRequestedLabel],
        { captureStdout: true, captureStderr: true, ignoreFailure: false });
    } catch (err) {
      return { id, error: err.stderr };
    }
  }

  // Retrieve information of a commit by its sha
  async #getCommitInfo(sha, opts) {
    if (!sha) {
      throw TypeError('No sha provided to get commit info');
    }

    const body = await forceRunAsync(
      'git', ['show', '-s', sha],
      { captureStdout: true, ignoreFailure: false });

    if (!body) {
      this.cli.warn(`Failed to retrieve commit body for sha: ${sha}`);
      return null;
    }

    const fullSha = this.#getFullCommitSha(body);
    const title = this.#getCommitTitle(body);
    const url = this.#getCommitPRUrl(body);
    const [id] = url.split('/').slice(-1);

    // validates retrieved commit info and warns if any of the values are
    // missing
    if (!fullSha || !title || !url) {
      this.cli.warn(`Failed to retrieve commit info for commit:\n${body}`);
      return null;
    }

    let labels;
    if (this.skipGH || opts?.skipGH) {
      labels = [];
    } else {
      const labelsJson = await forceRunAsync(
        'gh', ['pr', 'view', id, '--json=labels'],
        { captureStdout: true, ignoreFailure: false });
      labels = JSON.parse(labelsJson).labels.map(i => i.name);
    }

    return { fullSha, sha, title, url, id, labels, body };
  }

  // Public method that allows for automating the backport request for a PR
  // e.g: `git node staging --backport=12345`
  async requestBackport(id) {
    await this.maybeSetReleaseLine();
    this.cli.startSpinner('Requesting backport');
    const error = await this.#requestBackport(id, true);
    this.cli.stopSpinner();
    if (error) {
      this.cli.error(`Failed to automate backport request for PR: ${id}
${error.error}`);
    } else {
      this.cli.ok(`Backport requested for PR: #${id}`);
    }
  }

  // Runs the automated cherry-pick process, starting with fetching
  // branch-diff data, then cherry-picking each commit and generating
  // a report at the end of the process.
  // e.g: `git node staging`
  async run() {
    if (this.cherryPickInProgress()) {
      this.cli.error('Cherry-pick in progress, please resolve and run again');
      return;
    }

    this.cli.startSpinner('Fetching branch-diff');

    await this.maybeSetReleaseLine();

    // if there's a cached branch diff result, use it,
    // otherwise runs branch-diff again and cache the result
    const cachedBranchDiff = readFile(this.branchDiffCache);
    let branchDiffResult = cachedBranchDiff;
    if (!cachedBranchDiff) {
      // TODO(ruyadorno): it would be ideal to combine the pagination feature
      // here with the pagination/limit proposal from branch-diff in order to
      // avoid hitting GH API rate limits in very long-lived release lines:
      // https://github.com/nodejs/branch-diff/pull/67
      const branchDiffOutput = await this.getBranchDiff();
      branchDiffResult = branchDiffOutput;
      // in case a pagination is set, then limit the number of commits
      if (this.paginate) {
        branchDiffResult = branchDiffResult
          .trim()
          .split('\n')
          .slice(0, this.paginate)
          .join('\n');
      }
      writeFile(this.branchDiffCache, branchDiffResult);
    }

    const { cli } = this;
    this.cli.updateSpinner('Cherry-picking commits');

    const ghAutomationFailed = [];
    const ignored = [];
    const result = {
      success: [],
      errors: []
    };

    const shas = branchDiffResult.trim().split('\n');
    const remainingShas = [...shas];

    // validate the contents of branch diff result
    for (const sha of shas) {
      const shaRegex = /\b[0-9a-f]{7,40}\b/;
      if (!shaRegex.test(sha)) {
        throw new Error(
          'Incompatible branch-diff results found.\n' +
          'You might want to review the result values at: ' +
          this.branchDiffCache
        );
      }
    }

    // cherry-pick each sha
    for (const sha of shas) {
      // updates branch-diff cache to remove the currently cherry-picked sha
      remainingShas.shift();
      writeFile(this.branchDiffCache, remainingShas.join('\n'));

      this.cli.updateSpinner(`Cherry-picking: ${sha}`);

      // skips and mark as errored any commit that belongs to a PR that
      // has already been labelled backport-requested
      const info = await this.#getCommitInfo(sha, { skipGH: true });
      if (this.seenRequestBackportIds.has(info.id)) {
        result.errors.push(info);
        continue;
      }

      try {
        let shaFound = false;
        const res = await forceRunAsync('git', ['cherry-pick', sha.trim()],
          { captureStdout: 'lines', captureStderr: true, ignoreFailure: false });
        for (const line of res) {
          const branch = this.stagingBranch.replace(/[./-]/g, '\\$&');
          const successRegex =
            new RegExp(`^\\[${branch}\\ (?<sha>\\b[0-9a-f]{7,40}\\b)\\]`);
          const s = line.match(successRegex);
          if (s && s.groups && s.groups.sha) {
            const info = await this.#getCommitInfo(s.groups.sha);
            // if unable to retrieve commit info, skip
            if (!info) {
              this.cli.warn(
                `Failed to retrieve commit info for sha: ${s.groups.sha}`);
              continue;
            }
            result.success.push({
              fullSha: info.fullSha,
              sha: info.sha,
              title: info.title,
              url: info.url,
              id: info.id,
              labels: info.labels,
              originSha: sha,
              destinationSha: s.groups.sha
            });
            shaFound = true;
            continue;
          }
        }
        if (!shaFound) {
          this.cli.warn(
            `Could not match sha value after cherry-picking: ${sha}\n` +
            `Output: ${res.join('\n')}`);
        }
      } catch (e) {
        // if finding an empty commit, that probably means the commit was
        // already cherry-picked, it's safe to skip and continue
        if (e.stderr &&
          e.stderr.startsWith('The previous cherry-pick is now empty')) {
          ignored.push(sha);
          runSync('git', ['cherry-pick', '--skip']);
        } else {
          // when the commit fails to cherry-pick, mark
          // it as an error and continue to the next commit
          const errorRegex = /^error:.* (?<sha>\b[0-9a-f]{7,40}\b)\.\.\./m;
          const m = e.stderr && e.stderr.match(errorRegex);
          if (m && m.groups && m.groups.sha) {
            const info = await this.#getCommitInfo(m.groups.sha);
            if (info) {
              result.errors.push(info);
            } else {
              this.cli.error(
                'Failed to cherry-pick commit and unable to ' +
                'retrieve commit information for sha: ' + m.groups.sha
              );
            }

            // automate backport request for the original PR
            const error = await this.#requestBackport(info.id);
            if (error) {
              ghAutomationFailed.push(error);
            }

            // skip the current commit
            runSync('git', ['cherry-pick', '--skip']);
          } else {
            throw e;
          }
        }
      }
    }

    cli.stopSpinner();

    for (const sha of ignored) {
      this.cli.warn(`Ignoring already cherry-picked sha: ${sha}`);
    }

    for (const failed of ghAutomationFailed) {
      this.cli.error(`Failed to automate backport request for PR: #${failed.id}
${failed.error}`);
    }

    // TODO(ruyadorno): different reporters: html, txt
    switch (this.reporter) {
      case 'markdown': {
        this.cli.write(this.#markdownReport(result));
        break;
      }
      default: {
        this.cli.write(JSON.stringify(result, null, 2));
      }
    }

    // at the end of a successful run, throw away the branch diff cache
    fs.rmSync(this.branchDiffCache, { force: true });
  }
}
