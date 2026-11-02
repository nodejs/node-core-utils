# git-node

A custom Git command for managing pull requests. You can run it as
`git-node` or `git node`. To see the help text, run `git node`.

- [git-node](#git-node)
  - [`git node land`](#git-node-land)
    - [Prerequisites](#prerequisites)
    - [Git bash for Windows](#git-bash-for-windows)
    - [Demo \& Usage](#demo--usage)
    - [Optional Settings](#optional-settings)
  - [`git node backport`](#git-node-backport)
    - [Example](#example)
  - [`git node release`](#git-node-release)
    - [Example](#example-1)
  - [`git node security`](#git-node-security)
  - [`git node sync`](#git-node-sync)
  - [`git node metadata`](#git-node-metadata)
    - [Optional Settings](#optional-settings-1)
  - [`git node v8`](#git-node-v8)
    - [Prerequisites](#prerequisites-1)
    - [`git node v8 major`](#git-node-v8-major)
    - [`git node v8 minor`](#git-node-v8-minor)
    - [`git node v8 backport <sha..>`](#git-node-v8-backport-sha)
    - [`git node v8 list-patches`](#git-node-v8-list-patches)
    - [General options](#general-options)
  - [`git node vote`](#git-node-vote)
    - [Prerequisites](#prerequisites-2)
    - [Usage](#usage)
  - [`git node status`](#git-node-status)
    - [Example](#example-2)
  - [`git node benchmark`](#git-node-benchmark)
    - [Example](#example-3)
  - [`git node wpt`](#git-node-wpt)
    - [Example](#example-4)

## `git node land`

```
git-node land [prid|options]

Manage the current landing session or start a new one for a pull request

Positionals:
  prid, options  ID of the Pull Request                                 [number]

Options:
  --version       Show version number                                  [boolean]
  --help          Show help                                            [boolean]
  --apply         Apply a patch with the given PR id                    [number]
  --amend         Amend the current commit                             [boolean]
  --continue, -c  Continue the landing session                         [boolean]
  --final         Verify the landed PR and clean up                    [boolean]
  --abort         Abort the current landing session                    [boolean]
  --backport      Land a backport PR on a staging branch               [boolean]
  --yes           Assume "yes" as answer to all prompts and run
                  non-interactively. If an undesirable situation occurs, such as
                  a pull request or commit check fails, then git node land will
                  abort.                              [boolean] [default: false]
  --skipRefs      Prevent Fixes and Refs information from being added to commit
                  metadata                            [boolean] [default: false]


Examples:
  git node land 12344            Land https://github.com/nodejs/node/pull/12344
                                 in the current directory
  git node land --abort          Abort the current session
  git node land --amend          Append metadata to the current commit message
  git node land --final          Verify the landed PR and clean up
  git node land --continue       Continue the current landing session
  git node land --backport 30072 Land https://github.com/nodejs/node/pull/30072
                                 as a backport in the current directory
```

<a id="git-node-land-prerequisites"></a>

### Prerequisites

1. See the readme on how to
   [set up credentials](../README.md#setting-up-credentials).
1. It's a Git command, so make sure you have Git installed, of course.
1. Configure your upstream remote and branch name.

   ```
   $ cd path/to/node/project
   $ ncu-config set upstream your-remote-name
   $ ncu-config set branch your-branch-name
   ```

   For example

   ```
   # Add a remote called "upstream"
   $ git remote add upstream git@github.com:nodejs/node.git
   # See your remote names
   $ git remote -v

   upstream	git@github.com:nodejs/node.git (fetch)
   upstream	git@github.com:nodejs/node.git (push)

   # Tell ncu that your upstream remote is named "upstream"
   $ ncu-config set upstream upstream

   # Tell ncu that you are landing patches to "main" branch
   $ ncu-config set branch main
   ```

Note: If you are behind a firewall and run into `ECONNREFUSED` issues with
`raw.githubusercontent.com`, you can try setting up the command to read
the README from the local file system (you may need to make sure that the
collaborator contacts in this file is up-to-date and cover people you need
to include in the patch you want to land).

```
$ cd path/to/node/project
$ ncu-config set readme "$(pwd)/README.md"
```

### Git bash for Windows

If you are using `git bash` and having trouble with output use
`winpty git-node.cmd metadata $PRID`.

Current known issues with git bash:

- git bash Lacks colors.
- git bash output duplicates metadata.

### Demo & Usage

1. Landing multiple commits: https://asciinema.org/a/148627
2. Landing one commit: https://asciinema.org/a/157445

```
Steps to land a pull request:
==============================================================================
$ cd path/to/node/project

# If you have not configured it before
$ ncu-config set upstream <name-of-remote-to-nodejs/node>
$ ncu-config set branch main   # Assuming you are landing commits on main

$ git checkout main
$ git node land --abort          # Abort a landing session, just in case
$ git node land $PRID            # Start a new landing session
$ git node land $URL             # Start a new landing session using the PR URL

# Follow instructions provided.

$ git node land --final          # Verify all the commit messages
==============================================================================
```

Note that for all of these commands, you can run either
`git node <cmd>` or `git-node <cmd>` - they are just aliases.

```
git-node <command>

Commands:
  git-node land [prid|options]    Manage the current landing session or start a
                                  new one for a pull request
  git-node metadata <identifier>  Retrieves metadata for a PR and validates them
                                  against nodejs/node PR rules
  git-node v8 [major|minor|backport]  Update or patch the V8 engine

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

<a id="git-node-land-optional-settings"></a>

### Optional Settings

The same Settings used by
[`git node metadata`](#git-node-metadata-optional-settings) are also used by
`git node land`.

## `git node backport`

Demo: https://asciinema.org/a/221244

```
git node backport <identifier>

Backport a PR to a release staging branch.

Positionals:
  identifier  ID or URL of the pull request                            [string] [required]

Options:
  --version  Show version number                                                 [boolean]
  --help     Show help                                                           [boolean]
  --to       release to backport the commits to                        [number] [required]
```

### Example

```
Backporting https://github.com/nodejs/node/pull/12344 to v10.x

# Sync main with upstream for the commits, if they are not yet there
$ git checkout main
$ git node sync

# Backport existing commits from main to v10.x-staging
$ git checkout v10.x-staging
$ git node sync
$ git node backport 12344 --to 10
```

## `git node release`

```sh
git-node release [newVersion|options]

Manage an in-progress release or start a new one.

Positionals:
  newVersion, options  Version number of the release to be prepared or promoted

Options:
  --version   Show version number                                      [boolean]
  --help      Show help                                                [boolean]
  --prepare   Prepare a new release of Node.js                         [boolean]
  --security  Demarcate the new security release as a security release [boolean]
  --startLTS  Mark the release as the transition from Current to LTS   [boolean]
  --yes       Skip all prompts and run non-interactively               [boolean]
  --filterLabel Filter PR by label when preparing a security release   [string]
  --releaseDate Default relase date when --prepare is used.
                It must be YYYY-MM-DD   [string]
```

### Example

```sh
# Prepare a new release of Node.js tagged 1.2.3
git node release --prepare 1.2.3
```

```sh
# Prepare a new release of Node.js with an automatically-determined version number.
git node release --prepare
```

```sh
# Prepare the first Alpha release of a new release line
git node release --prepare 27.0.0-alpha.0.0.0
```

```sh
# Prepare the semver-major release of an Alpha release line, which marks it
# as out of Alpha.
git node release --prepare 27.0.0
```

```sh
# Prepare the first LTS release for a given release line
git node release --prepare --startLTS
```

```sh
# Prepare security release
git node release --prepare --security --filterLabel 18.x 18.20.1
```

```
# Skip the branch-diff initial check (useful when updating ongoing proposals)
git node release --prepare 1.2.3 --skipBranchDiff
```

## `git node sync`

Demo: https://asciinema.org/a/221230

```
git node sync

Sync the branch specified by ncu-config.

Options:
  --version  Show version number                                                 [boolean]
  --help     Show help                                                           [boolean]
```

## `git node metadata`

This tool is inspired by Evan Lucas's [node-review](https://github.com/evanlucas/node-review),
although it is a CLI implemented with the GitHub GraphQL API.

```
git-node metadata <identifier>

Retrieves metadata for a PR and validates them against nodejs/node PR rules

Positionals:
  identifier  ID or URL of the pull request                            [string] [required]

Options:
  --version         Show version number                                          [boolean]
  --help            Show help                                                    [boolean]
  --owner, -o       GitHub owner of the PR repository         [string] [default: "nodejs"]
  --repo, -r        GitHub repository of the PR                 [string] [default: "node"]
  --file, -f        File to write the metadata in                                 [string]
  --readme          Path to file that contains collaborator contacts              [string]
  --check-comments  Check for 'LGTM' in comments                                 [boolean]
  --json            Print metadata and PR readiness result as JSON               [boolean]
  --max-commits     Number of commits to warn                        [number] [default: 3]
```

Examples:

```bash
PRID=12345

# fetch metadata and run checks on nodejs/node/pull/$PRID
$ git node metadata $PRID
# is equivalent to
$ git node metadata https://github.com/nodejs/node/pull/$PRID
# is equivalent to
$ git node metadata $PRID -o nodejs -r node

# Or, redirect the metadata to a file while see the checks in stderr
$ git node metadata $PRID > msg.txt

# Or, get machine-readable metadata and readiness reason codes
$ git node metadata $PRID --json

# Using it to amend commit messages:
$ git node metadata $PRID -f msg.txt
$ echo -e "$(git show -s --format=%B)\n\n$(cat msg.txt)" > msg.txt
$ git commit --amend -F msg.txt

# fetch metadata and run checks on https://github.com/nodejs/llnode/pull/167
# using the contact in ../node/README.md
git node metadata 167 --repo llnode --readme ../node/README.md
```

When `--json` is used, stdout contains a JSON object and progress/check output
is written to stderr. The command still exits non-zero when the pull request is
not ready to land. The JSON includes `ready`, `readiness`, `exitCode`,
`pullRequest`, `metadata`, `reasonCodes`, and `reasons`. `pullRequest.labels` is
an array of the pull request's label names. `reasonCodes` is a de-duplicated
list of stable machine-readable codes such as `missing-approval`,
`missing-tsc-approval`, `wait-time`, `missing-github-ci`, `pending-github-ci`,
`conflict`, `requested-changes`, and `stale-review`.

The metadata JSON exit-code contract is:

- `0`: the pull request is ready
- `20`: the pull request is not ready, but only for the deferrable metadata
  reason currently owned by the lightweight queue selector: `wait-time`
- `40`: the pull request is not ready for a hard or mixed reason and should be
  handled by the existing landing/failure path

Exit codes `20`-`29` are reserved for future deferrable metadata states, and
`40`-`49` are reserved for future hard metadata failure states. Unexpected tool
or runtime failures continue to use exit code `1`.

<a id="git-node-metadata-optional-settings"></a>

### Optional Settings

Some projects might not follow the same rules as nodejs/node. To properly
validate Pull Requests for these projects, node-core-utils accept the following
optional settings:

```bash
cd path/to/project
# waitTimeSingleApproval is the minimum wait time (in hours) before
# landing a PR with only one approval. Default to 7 days.
ncu-config set waitTimeSingleApproval 168
# waitTimeMultiApproval is the minimum wait time (in hours) before
# landing a PR with only two or more approvals. Default to 48 hours.
ncu-config set waitTimeMultiApproval 48
```

## `git node v8`

Update or patch the V8 engine.
This tool will maintain a clone of the V8 repository in `~/.update-v8/v8`
if it's used without `--v8-dir`.

<a id="git-node-v8-prerequisites"></a>

### Prerequisites

If you are on macOS, the version of `patch` command bundled in the system may
be too old for `git node v8` to work. Try installing a newer version of patch
before using this tool. For instance, with homebrew:

```
$ brew install gpatch
```

And make sure `which patch` points to `/usr/local/bin/patch` installed by
homebrew instead of `/usr/bin/patch` that comes with the system (e.g. by
modifying your `PATH` environment variable).

### `git node v8 major`

- Replaces `deps/v8` with a newer major version.
- Synchronizes the manifest and vendored Rust crates in `deps/crates`.
- Resets the embedder version number to `-node.0`.
- Bumps `NODE_MODULE_VERSION` according to the [Node.js ABI version registry][].

Options:

- `--branch=branchName`: Branch of the V8 repository to use for the upgrade.
  Defaults to `lkgr`.

- `--no-version-bump`: Disable automatic bump of the `NODE_MODULE_VERSION`
  constant.

- `--cargo=/path/to/cargo`: The Cargo binary that will be executed by the shell
  when updating the Rust crates. Defaults to `cargo`.

### `git node v8 minor`

Compare current V8 version with latest upstream of the same major. Applies a
patch if necessary.
If the `git apply` command fails, a patch file will be written in the Node.js
clone directory.

### `git node v8 backport <sha..>`

Fetches and applies the patch corresponding to `sha`. Multiple commit SHAs can
be provided to this command. Increments the V8 embedder version number or patch
version and commits the changes for each commit (unless the command is
called with `--squash`). If a patch fails to be applied, the command will pause
and let you fix the conflicts in another terminal.

Options:

- `--no-bump`: Set this flag to skip bumping the V8 embedder version number or
  patch version.
- `--squash`: Set this flag to squash multiple commits into one. This should
  only be done if individual commits would break the build.

### `git node v8 list-patches`

Lists every V8 patch Node.js carries since its last V8 import. For each one,
reports the V8 version it first shipped in and the release branches it was
merged back to.

With `--target`, it also reports whether the target line's `<line>-lkgr`
branch contains each patch, in an extra `in_target` column. Use this before a
major update to find the patches that need to be reapplied.

Prints `#` header lines, then a table with one row per patch in commit order.
Each `patch-level` row shows the version range it updated across, and its
`branch-merge` rows hang under it. A `cherry-pick` row shows the subject of
the original V8 commit. With `--target 15.7`:

```
node_commit  kind          upstream_ref            released_in  backported_to            in_target           subject
7c2eaad2967  cherry-pick   785a2ea88a90            15.8.25      -                        missing             [tracing] do not define legacy tracing classes when using Perfetto
352e81424fe  patch-level   15.6.75.13..15.6.75.25  -            -                        -                   deps: patch V8 to 15.6.75.25
├─           branch-merge  a4b5ec9b7260            15.7.41      15.6.75.14               ancestor            [M156] [maglev] ...
└─           branch-merge  0fd76b79067d            15.8.7       15.6.75.19, 15.7.112.4   merged:af8f5a21f5e  [M156] [maglev range analysis] ...
```

With `--tsv`, the rows are tab-separated for scripts instead. There, each
`branch-merge` row repeats the `node_commit` of its `patch-level` row, a
`patch-level` row's `upstream_ref` is only the version it updated from, and
every row shows the subject of the Node.js commit.

- `kind` says where the patch came from:
  - `cherry-pick`: a `deps: V8: cherry-pick` or `deps: V8: backport` commit,
    usually made by `git node v8 backport`. Node took one V8 commit on its own.
  - `patch-level`: a `deps: patch V8 to X.Y.Z.W` commit, usually made by
    `git node v8 minor`. Node moved to a newer patch version of the same V8
    release line. It is followed by its `branch-merge` rows.
  - `branch-merge`: one fix that V8 merged into its release branch between the
    old and new versions of the `patch-level` update above it. Node got it
    through that update, not as a commit of its own.
  - `node-only`: any other commit touching `deps/v8`, such as a build fix
    written for Node.
- `released_in` is the earliest V8 version tag containing the upstream commit
  on V8 main.
- `backported_to` lists each release line older than `released_in`, from
  Node's current line onward, that the fix was merged back to. The table
  shows the first version on each line with the fix. `--tsv` shows
  `<line>:<sha>@<first version with it>`. Each line is searched up to its
  `<line>-lkgr` branch.
- `in_target` is only shown with `--target`, and is one of:
  - `ancestor`: the upstream commit is an ancestor of the target.
  - `merged:<sha>`: in the target under a new SHA.
  - `missing`: the upstream commit exists but the target lacks it.
  - `missing:<sha>`: on V8 main under a new SHA, but the target lacks it.
  - `unknown`: no upstream commit found to check against.
  - `-`: `patch-level` rows, see their `branch-merge` rows instead.
- `diff` is only shown with `--check-diff`. For a `cherry-pick` row with an
  upstream commit on V8 main, it compares the `git patch-id --stable` of the
  Node.js commit's `deps/v8` changes with that of the upstream commit. Both
  diffs omit context lines, so code around the change that differs between
  Node.js's V8 and V8 main does not count. It is one of:
  - `same`: the changed lines match, ignoring whitespace.
  - `differs`: Node.js changed the patch, or picked a different patchset than
    the one that landed. `deps: V8: backport` commits usually differ. Upstream
    changes to files Node.js does not vendor also make the diffs differ.
  - `-`: every other row.

When updating V8 to the target line, run with `--target` and review the
`cherry-pick`,
`branch-merge`, and `node-only` rows. `patch-level` rows need no action.

- Rows with `ancestor` or `merged:<sha>` are already in the target and can be
  dropped. If `--check-diff` shows `differs`, check first that the target does
  not need the changes Node.js made to the patch.
- Rows with `missing` or `missing:<sha>` must be reapplied, for example with
  `git node v8 backport`. For `missing:<sha>`, backport that SHA rather than
  the one in `upstream_ref`.
- Rows with `unknown` need a look by hand. This includes every `node-only`
  row. Reapply them if the target still needs them.

Options:

- `--target=MAJOR.MINOR`: V8 release line to upgrade to, for example `15.7`
  when `deps/v8` is on 15.6. Adds the `in_target` column, which tells whether
  the line's `<line>-lkgr` branch contains each patch. Without it, backports
  are searched on every release line from Node's current one onward.
- `--base=ref`: Node.js ref to read the V8 patches from. Defaults to
  `upstream/main`.
- `--no-fetch`: Skip fetching V8 and the remote branch of `--base`.
- `--check-diff`: Add the `diff` column, which compares each `cherry-pick`
  row's diff with its upstream commit.
- `--tsv`: Print tab-separated rows instead of an aligned table.

The V8 clone, from `--v8-dir` or the one maintained in `--base-dir` (see
[General options](#general-options)), must be a full clone with tags and the
`origin/<line>-lkgr` branches.

### General options

- `--node-dir=/path/to/node`: Specify the path to the Node.js git repository.
  Defaults to current working directory.
- `--base-dir=/path/to/base/dir`: Specify the path where V8 the clone will
  be maintained. Defaults to `~/.update-v8`.
- `--v8-dir=/path/to/v8/`: Specify the path of an existing V8 clone. This
  will be used instead of cloning V8 to `baseDir`.
- `--verbose`: Enable verbose output.

## `git node vote`

### Prerequisites

1. See the readme on how to
   [set up credentials](../README.md#setting-up-credentials).
1. It's a Git command, so make sure you have Git installed, of course.

Additionally, if you want to close the vote, you also need:

1. A GPG client. By default it will look at the `GPG_BIN` environment variable,
   and fallback to `gpg` if not provided.

### Usage

```
Steps to cast a vote:
==============================================================================
$ git node vote $PR_URL                 # Start a voting session
$ git node vote $PR_URL --abstain       # Cast an empty ballot
$ git node vote $PR_URL --protocol ssh  # Instruct git-node to use SSH
==============================================================================

Steps to close a vote:
==============================================================================
$ git node vote $PR_URL --decrypt-key-part   # Outputs the user's key part
$ git node vote \
  $PR_URL --decrypt-key-part --post-comment  # Post the key part as comment
==============================================================================
```

## `git node security`

Manage or starts a security release process.

Every `git node security` action asks for permission before each mutating step.
Read-only operations, such as reading files or fetching report data, run without
confirmation. Each confirmation names the command or service action that will
write state and explains the side effect, such as writing files, committing and
pushing changes, creating issues, or updating HackerOne reports.

<a id="git-node-security-prerequisites"></a>

### Prerequisites

It's necessary to set up `.ncurc` with HackerOne keys:

```console
$ ncu-config --global set -x h1_token
$ ncu-config --global set h1_username $H1_TOKEN
```

- `h1_token`: HackerOne Organization API Token, preferable with read-only
  access.
- `h1_username`: HackerOne API Token username.

### `git node security --start`

This command prepares `vulnerabilities.json` and can open the Next Security
Release pull request in `nodejs-private/security-release`, following the
[Security Release Process][] document. It retrieves all pages of triaged
HackerOne reports and uses the same candidate list for exclusions and selection.
The CLI prompts for the release date, report selection, and dependency updates
before writing the draft. Commit, push, and PR creation remain separate
confirmed steps. An existing `next-security-release` branch is checked out
without resetting it. If only `origin/next-security-release` exists locally,
the command creates a tracking branch from that ref. Fetch first when remote
state may have changed.

Security release commits reject unrelated staged changes before staging their
own files. Commit or unstage those changes before continuing. `--start` refuses
to overwrite an existing draft, including one found after switching branches.
Use `--sync`, `--add-report`, or `--remove-report` to update that release.

#### Preparing release data without the CLI

`lib/security-release/preparation.js` exposes helpers that can be used by other
local tools:

- `listSecurityReleaseCandidates(request)` accepts an authenticated NCU
  `Request` and returns the triaged HackerOne report objects. A failed page
  rejects the operation rather than returning an incomplete candidate list.
  It does not fetch extra report history or make report-selection decisions.
- `buildIncludedTriagedReport(report, options)` converts a HackerOne report to
  release metadata. Supply affected lines and patch authors explicitly; it
  does not discover them or fetch a patch.
- `prepareSecurityRelease({ releaseDate, reports, dependencies })` accepts the
  selected release report entries and dependency updates. It returns
  `{ release, missingInformation }`, without requests, prompts, filesystem
  writes, Git operations, or publication.

The preparation helper accepts `TBD`, `YYYY/MM/DD`, or `YYYY-MM-DD` dates and
normalizes defined dates to `YYYY-MM-DD`. It accepts legacy affected-line arrays
and strings as well as PR maps, and writes maps keyed by release line. Existing
map URLs are preserved. A report's canonical PR is not automatically assigned
to every affected line: unknown backport URLs remain empty. Legacy dependency
updates retain their explicit association between their PR and affected lines.

The result is an independent copy of the input. Duplicate report IDs, invalid
dates, and conflicting release-line mappings are rejected. Missing report
metadata is listed for follow-up; a draft with no reports can still contain
dependency updates. These checks prepare a draft, not a final-release approval.
The caller owns selection, human review, persistence, and publication.

After reviewing the prepared data, local tools can use
`writeSecurityReleaseDraft(directory, release)` from
`lib/security-release/draft.js`. The directory is an explicit security-release
repository path. The helper validates the draft and creates
`security-release/next-security-release/vulnerabilities.json` with an exclusive
write, so an existing file cannot be overwritten. It does not change Git state
or publish anything. Review and authorization belong to the calling tool; the
CLI retains its directory and file-write confirmations.

### `git node security --apply-patches`

This command fetches the list of reports and the list of PRs labelled for the
release corresponding to the CWD, and match them in pair, and run a
`git node land` session for each.

### `git node security --update-date=YYYY/MM/DD`

This command updates the `vulnerabilities.json` with target date of the security release.
Example:

```sh
  git node security --update-date=2023/12/31
```

### `git node security --pre-release`

This command creates a pre-release announcement for the security release.
Example:

```sh
  git node security --pre-release="/path/to/nodejs.org"
```

### `git node security --post-release`

This command creates the post-release announcement for the security release.
Example:

```sh
  git node security --post-release="/path/to/nodejs.org"
```

### `git node security --add-report=report-id`

This command adds a HackerOne report to the `vulnerabilities.json`.
Example:

```sh
  git node security --add-report=12345
```

### `git node security --remove-report=report-id`

This command removes a HackerOne report from the `vulnerabilities.json`.
Example:

```sh
  git node security --remove-report=12345
```

## `git node status`

Return status and information about the current git-node land session. Shows the following information:

- PR URL (`https:/github.com/nodejs/node/<prid>`)
- `git-node` landing session status, one of:
  - `APPLYING`
  - `STARTED`
  - `AMENDING`
- Current username
- Current upstream
- Current target branch for the landing session

### Example

```sh
node on git:main ❯ git node status                                             11:32AM
   ✔  Landing session in progress
--------------------------------------------------------------------------------
PR:        https:/github.com/nodejs/node/pull/34800
State:     AMENDING
Username:  codebytere
Upstream:  upstream
Branch:    main
```

## `git node benchmark`

Trigger the [`benchmark.yml`][] GitHub Actions workflow on a pull request. The
command fetches the PR, then prompts you to pick which benchmark categories to
run (the folders in [`benchmark/`][] at the PR head). Categories whose files are
touched by the PR are checked by default; if the PR touches no benchmark file,
the pre-selection is guessed from the PR's subsystem labels. You are then prompted for an optional
filter substring; if the PR touches a single benchmark file and only that file's
category is selected, the filter is pre-filled with that file's name. Finally you
are asked whether the workflow should post the results as a comment on the PR. It
then dispatches the workflow with the PR number and its head commit.

```
git-node benchmark <identifier>

Trigger the benchmark GitHub Actions workflow for a pull request

Positionals:
  identifier  ID or URL of the pull request; a commit URL
              (…/pull/<id>/commits/<sha>) benchmarks that commit  [string] [required]

Options:
  --version         Show version number                                          [boolean]
  --help            Show help                                                    [boolean]
  --owner, -o       GitHub owner of the PR repository         [string] [default: "nodejs"]
  --repo, -r        GitHub repository of the PR                 [string] [default: "node"]
  --workflow-owner  GitHub owner of the repository hosting the benchmark workflow
                    (defaults to the PR owner)                                     [string]
  --workflow-repo   GitHub repository hosting the benchmark workflow (defaults to the PR
                    repository)                                                   [string]
  --workflow        The workflow file to dispatch   [string] [default: "benchmark.yml"]
  --ref             The git ref of the workflow repository to run the workflow from
                                                                 [string] [default: "main"]
  --runs            How many times to repeat each benchmark                       [number]
```

The workflow is dispatched on the PR's repository by default. When the workflow
lives in a different repository (for example a fork that hosts `benchmark.yml`),
pass `--workflow-owner`/`--workflow-repo`, and the PR repository is forwarded to
the workflow so it fetches the PR from the right place.

### Example

```bash
# Interactively pick benchmark categories to run on nodejs/node#12344
# (categories touched by the PR are pre-selected)
$ git node benchmark 12344
# is equivalent to
$ git node benchmark https://github.com/nodejs/node/pull/12344

# Repeat each benchmark 10 times (the filter is asked interactively)
$ git node benchmark 12344 --runs 10

# Dispatch the workflow hosted on a fork for a nodejs/node PR
$ git node benchmark 12344 --workflow-owner my-user --workflow-repo node

# Benchmark a specific PR commit instead of the current PR head
$ git node benchmark https://github.com/nodejs/node/pull/12344/commits/abc1234
```

## `git node wpt`

Update or patch the Web Platform Tests in core.
The updated files are placed under `./test/fixtures/wpt` by default. In addition
to the assets, this also updates:

- `./test/fixtures/wpt/versions.json`
- `./test/fixtures/wpt/LICENSE.md`

```
git-node wpt <name>

Updates WPT suite

Positionals:
  name  Subset of the WPT to update                          [string] [required]

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
  --commit   A specific commit the subset should be updated to          [string]
  --nodedir  Path to the node.js project directory       [string] [default: "."]
```

### Example

```
$ cd /path/to/node/project
$ git node wpt url  # Will update test/fixtures/wpt/url and related files
# Will update test/fixtures/wpt/url and related files to the specified commit
$ git node wpt url --commit=43feb7f612fe9160639e09a47933a29834904d69
```

[node.js abi version registry]: https://github.com/nodejs/node/blob/main/doc/abi_version_registry.json
[Security Release Process]: https://github.com/nodejs/node/blob/main/doc/contributing/security-release-process.md
[`benchmark.yml`]: https://github.com/nodejs/node/blob/main/.github/workflows/benchmark.yml
[`benchmark/`]: https://github.com/nodejs/node/tree/main/benchmark
