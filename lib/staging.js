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
  #resultState = undefined;

  constructor({
    cli,
    dir,
    autoSkip,
    cont,
    paginate,
    releaseLine,
    reportDestination,
    reporter,
    skip,
    skipGH
  }) {
    super(cli, dir);
    if (!this.config.branch) {
      this.warnForMissing();
    }

    this.cli = cli;
    this.dir = dir;
    this.autoSkip = autoSkip;
    this.cont = cont;
    this.paginate = paginate;
    this.skip = skip;
    this.skipGH = skipGH;
    this.releaseLine = releaseLine;
    this.reportDestination = reportDestination;
    this.reporter = reporter;
    this.#resultState = this.resultState;
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

  get resultStatePath() {
    return path.resolve(this.ncuDir, 'in-progress-staging-result.json');
  }

  get branchDiffCache() {
    return path.resolve(this.ncuDir, 'branch-diff-output-' + this.stagingBranch);
  }

  get resultState() {
    if (this.#resultState) {
      return this.#resultState;
    }
    return readJson(this.resultStatePath);
  }

  set resultState(obj) {
    // remove the result state file if the object is undefined
    if (obj === undefined) {
      this.#resultState = undefined;
      fs.rmSync(this.resultStatePath, { force: true });
      return;
    }
    this.#resultState = obj;
    writeJson(this.resultStatePath, obj);
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
      // comparison branch should always be the next release line
      // and limited to the latest release line available
      const currentReleaseLine = parseInt(this.releaseLine, 10);
      // the next release line is always the next even number
      const nextReleaseLine = (currentReleaseLine + 1) % 2
        ? currentReleaseLine + 2
        : currentReleaseLine + 1;
      comparisonBranch = nextReleaseLine < latestReleaseLine
        ? `v${nextReleaseLine}.x`
        : `v${latestReleaseLine}.x`;
    } else {
      comparisonBranch = 'main';
    }

    this.cli.updateSpinner('Fetching upstream comparison branch: ' + comparisonBranch);

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
      const shouldUpBranch = this.cli.prompt(
        `Local ${comparisonBranch} branch is not in sync with ${
upstream}/${comparisonBranch}, do you want to update it?`);
      if (shouldUpBranch) {
        await forceRunAsync('git', ['branch', '-f', comparisonBranch, 'FETCH_HEAD'], {
          ignoreFailures: false
        });
      }
    }

    // TODO(ruyadorno): this is not a great way of finding the branch diff
    // binary, it's going to be incompatible in cases where the node_modules
    // folder is not at this specific location, such as when running from npx
    // or using package managers other than npm.
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

  #getReport(result) {
    // TODO(ruyadorno): different reporters: html, txt
    switch (this.reporter) {
      case 'markdown': {
        return this.#markdownReport(result);
      }
      default: {
        return JSON.stringify({
          success: result.success,
          errors: result.errors,
          ignored: result.ignored
        }, null, 2);
      }
    }
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
    const { success, errors, ignored } = result;
    const mkdownItem = (arr) => arr.map(
      ({ fullSha, sha, title, url, labels = [] }) => {
        const s = fullSha
          ? `[\`${sha}\`](https://github.com/nodejs/node/commit/${fullSha})`
          : `\`${sha}\``;
        return `* ${s} ` +
        `[${title}](${url}) ` +
        `${labels.map(i => '`' + i + '`').join(', ')}`;
      }).join('\n');

    return `# \`${this.stagingBranch}\` Cherry-pick Report` +
      (
        success.length > 0
          ? `\n## ${success.length} successfully cherry-picked commits:
${mkdownItem(success)}`
          : ''
      ) +
      (
        errors.length > 0
          ? `\n## ${errors.length} commits that failed to cherry-pick:
${mkdownItem(errors)}`
          : ''
      ) +
      (
        ignored.length > 0
          ? `\n## ${ignored.length} commits that were ignored:
${ignored.map(i => '* `' + i + '`').join('\n')}`
          : ''
      );
  }

  // Use the GitHub CLI `gh` to automatically request a backport to a PR
  // by setting the appropriate label and adding a comment.
  async #requestBackport(id, comment = false) {
    const result = this.resultState;
    if (this.skipGH || result.seenRequestBackportIds.includes(id)) {
      return;
    }
    result.seenRequestBackportIds.push(id);
    this.resultState = result;

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
      this.cli.error('Cherry-pick in progress, please resolve and try again');
      this.cli.setExitCode(1);
      return;
    }

    // if there's a stored current commit sha, then we need the user to
    // either mark it as fixed (using --continue) or skipped (using --skip)
    if (this.resultState?.currentSha) {
      // if neither --continue or --skip are set, then we error out
      if (!this.cont && !this.skip) {
        this.cli.error(
          'It looks like you have an ongoing staging session stored.\n' +
          '      When resuming the staging process, you must signal what\n' +
          '      is the current resolution for that conflicting commit.\n' +
          '        - Conflicts were fixed and commit is included:\n' +
          '          `git node staging --continue`\n' +
          '        - Unable to fix conflicts and commit should be skipped:\n' +
          '          `git node staging --skip`\n'
        );
        this.cli.setExitCode(1);
        return;
      }

      const result = this.resultState;
      const sha = result.currentSha;
      result.currentSha = undefined;
      this.resultState = result;

      const info = await this.#getCommitInfo(sha);
      const infoMissing = () => {
        this.cli.info(
          `Failed to retrieve commit info for sha: ${sha}\n` +
          '   Note that the commit will be missing from the final report.'
        );
      };
      if (this.cont) {
        this.cli.info(
          'Continuing cherry-pick process from last known commit: ' +
          sha
        );
        if (info) {
          result.success.push({
            fullSha: info.fullSha,
            sha: info.sha,
            title: info.title,
            url: info.url,
            id: info.id,
            labels: info.labels,
            originSha: sha,
            destinationSha: sha
          });
          this.resultState = result;
        } else {
          infoMissing();
        }
      } else if (this.skip) {
        this.cli.info(
          'Continuing cherry-pick process skipping last known commit: ' +
          sha
        );
        if (info) {
          result.errors.push(info);
          this.resultState = result;
          await this.#requestBackport(info.id);
        } else {
          infoMissing();
        }
      }
    }

    this.cli.startSpinner('Fetching list of commits using branch-diff.\n');

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

    this.cli.stopSpinner('Successfully fetched list of commits to cherry-pick');

    const ghAutomationFailed = [];
    // if there's a previous result state, use it, otherwise create a new one
    const result = this.resultState?.success
      ? this.resultState
      : {
          currentSha: undefined,
          ignored: [],
          success: [],
          errors: [],
          seenRequestBackportIds: []
        };
    this.resultState = result;

    const shas = branchDiffResult.trim().split('\n');
    const remainingShas = [...shas];

    if (!shas.length || (shas.length === 1 && shas[0] === '')) {
      this.cli.ok('No commits to cherry-pick. Looks like the branch is up to date.');
      return;
    }

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
      result.currentSha = sha;
      this.resultState = result;

      // updates branch-diff cache to remove the currently cherry-picked sha
      remainingShas.shift();
      writeFile(this.branchDiffCache, remainingShas.join('\n'));

      this.cli.startSpinner(`Cherry-picking: ${sha}`);

      // skips and mark as errored any commit that belongs to a PR that
      // has already been labelled backport-requested
      const info = await this.#getCommitInfo(sha, { skipGH: true });
      if (result.seenRequestBackportIds.includes(info.id)) {
        result.errors.push(info);
        this.resultState = result;
        this.cli.stopSpinner(
          `Skipping already backport-requested commit: ${sha}`,
          'info'
        );
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
              this.cli.stopSpinner(
                `Failed to retrieve commit info for sha: ${s.groups.sha}\n` +
                'Note that while the commit will be missing from the final report\n' +
                'it has been successfully cherry-picked to the staging branch.\n',
                'warn'
              );
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
            this.resultState = result;
            this.cli.stopSpinner(`Cherry-picked: ${sha}`);
            shaFound = true;
            continue;
          }
        }
        if (!shaFound) {
          this.cli.stopSpinner(
            `Could not match sha value after cherry-picking: ${sha}\n` +
            'Note that while the commit will be missing from the final report\n' +
            'it has been successfully cherry-picked to the staging branch.\n' +
            'Output / More info:\n' +
            `${res.join('\n')}`, 'warn');
        }
      } catch (e) {
        // if finding an empty commit, that probably means the commit was
        // already cherry-picked, it's safe to skip and continue
        if (e.stderr &&
          e.stderr.startsWith('The previous cherry-pick is now empty')) {
          this.resultState.ignored.push(sha);
          this.resultState = result;
          this.cli.stopSpinner(`Skipping an empty commit: ${sha}`, 'warn');
          runSync('git', ['cherry-pick', '--skip']);
        } else if (this.autoSkip) {
          // in auto skip mode, when the commit fails to cherry-pick,
          // we just mark it as an error and continue to the next commit
          const errorRegex = /^error:.* (?<sha>\b[0-9a-f]{7,40}\b)\.\.\./m;
          const m = e.stderr && e.stderr.match(errorRegex);
          if (m && m.groups && m.groups.sha) {
            const info = await this.#getCommitInfo(m.groups.sha);
            if (info) {
              result.errors.push(info);
              this.resultState = result;

              // automate backport request for the original PR
              const error = await this.#requestBackport(info.id);
              if (error) {
                ghAutomationFailed.push(error);
              }
            } else {
              this.cli.error(
                'Failed to cherry-pick commit and unable to ' +
                'retrieve commit information for sha: ' + m.groups.sha
              );
            }

            // skip the current commit
            runSync('git', ['cherry-pick', '--skip']);
            this.cli.stopSpinner(`Skipping a conflicting commit: ${sha}`, 'warn');
          } else {
            this.cli.error('Unexpected error while trying to skip commit: ' + sha);
            throw e;
          }
        } else {
          let commitInfo = '';
          const info = await this.#getCommitInfo(sha);
          if (info) {
            commitInfo = `   │ COMMIT INFO:
   │ SHA: ${sha}
   │ Title: ${info.title}
   │ PR-URL: ${info.url}`;

            if (info.labels.length) {
              const labelNames = `\n   │ Labels: ${info.labels.join(', ')}\n\n`;
              commitInfo += labelNames;
            } else {
              commitInfo += '\n\n';
            }
          } else {
            commitInfo = `   Run: \`git show -s ${sha}\` to get more info\n\n`;
          }
          this.cli.stopSpinner(
            'Conflict detected, please resolve to continue.\n\n' + commitInfo +
            '   You will need to either manually resove the conflict by fixing\n' +
            '   the affected files, adding these fixes with `git add <filename>`\n' +
            '   and then run `git cherry-pick --continue` OR\n' +
            '   manually skip the commit by running `git cherry-pick --skip`.\n\n' +
            '   Once resolved, you can resume the staging process by running\n' +
            '   `git node staging --continue` in case of a successful resolution OR\n' +
            '   `git node staging --skip` in case of a commit that should be skipped.\n',
            'info'
          );
          process.exit(1);
        }
      }
    }
    // clear up reference to the current sha
    result.currentSha = undefined;
    this.resultState = result;

    this.cli.stopSpinner();

    for (const failed of ghAutomationFailed) {
      this.cli.error(`Failed to add backport-requested label. PR: #${failed.id}
${failed.error}`);
    }

    // finishes up by writing the report to the proper destination
    const report = this.#getReport(result);
    const printReport = () => {
      this.cli.info(
        'Report was not posted to GitHub and is printed to\n' +
        '      stdout instead. Make sure to save it for future reference.\n'
      );
      this.cli.write(report);
    };
    const shouldOpenIssue = () => this.cli.prompt(
      'Open an issue on GitHub with the final report?');
    if (this.reportDestination === 'stdout') {
      this.cli.info('Cherry-pick report:\n');
      this.cli.write(report);
    } else if (this.reportDestination !== undefined) {
      try {
        writeFile(this.reportDestination, report);
        this.cli.info(
          `Cherry-pick report wrote to: ${this.reportDestination}\n`);
      } catch (err) {
        this.cli.error(err);
        this.cli.info(
          'Failed to write report to `reportDestination` and printing to\n' +
          '      stdout instead. Make sure to save it for future reference.\n'
        );
        this.cli.write(report);
      }
    } else if (this.reportDestination === 'github' || await shouldOpenIssue()) {
      const title = `${this.stagingBranch} cherry-pick report`;
      try {
        await forceRunAsync('gh', [
          'issue',
          'create',
          '--title',
          `${title}`,
          '--body',
          `${report}`,
          '--assignee',
          '@me'
        ].concat(this.reportDestination !== 'github' ? ['--web'] : []),
        { captureStdout: true, captureStderr: true, ignoreFailure: false });
      } catch (err) {
        this.cli.error(err);
        printReport();
      }
    } else {
      printReport();
    }

    // at the end of a successful run, throw away the state persistency files
    this.reset();
  }

  async reset() {
    await this.maybeSetReleaseLine();
    fs.rmSync(this.branchDiffCache, { force: true });
    this.resultState = undefined;
  }
}
