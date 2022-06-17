# git-node

A custom Git command for managing pull requests. You can run it as
`git-node` or `git node`. To see the help text, run `git node`.

- [git-node](#git-node)
  - [`git node land`](#git-node-land)
    - [Prerequisites](#prerequisites)
    - [Git bash for Windows](#git-bash-for-windows)
    - [Demo & Usage](#demo--usage)
    - [Optional Settings](#optional-settings)
  - [`git node backport`](#git-node-backport)
    - [Example](#example)
  - [`git node release`](#git-node-release)
    - [Example](#example-1)
  - [`git node sync`](#git-node-sync)
  - [`git node metadata`](#git-node-metadata)
    - [Optional Settings](#optional-settings-1)
  - [`git node v8`](#git-node-v8)
    - [Prerequisites](#prerequisites-1)
    - [`git node v8 major`](#git-node-v8-major)
    - [`git node v8 minor`](#git-node-v8-minor)
    - [`git node v8 backport <sha..>`](#git-node-v8-backport-sha)
    - [General options](#general-options)
  - [`git node status`](#git-node-status)
    - [Example](#example-2)
  - [`git node wpt`](#git-node-wpt)
    - [Example](#example-3)

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

# Using it to amend commit messages:
$ git node metadata $PRID -f msg.txt
$ echo -e "$(git show -s --format=%B)\n\n$(cat msg.txt)" > msg.txt
$ git commit --amend -F msg.txt

# fetch metadata and run checks on https://github.com/nodejs/llnode/pull/167
# using the contact in ../node/README.md
git node metadata 167 --repo llnode --readme ../node/README.md
```

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
modifying yoru `PATH` environment variable).

### `git node v8 major`

- Replaces `deps/v8` with a newer major version.
- Resets the embedder version number to `-node.0`.
- Bumps `NODE_MODULE_VERSION` according to the [Node.js ABI version registry][].

Options:

- `--branch=branchName`: Branch of the V8 repository to use for the upgrade.
  Defaults to `lkgr`.

- `--no-version-bump`: Disable automatic bump of the `NODE_MODULE_VERSION`
  constant.

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

### General options

- `--node-dir=/path/to/node`: Specify the path to the Node.js git repository.
  Defaults to current working directory.
- `--base-dir=/path/to/base/dir`: Specify the path where V8 the clone will
  be maintained. Defaults to `~/.update-v8`.
- `--v8-dir=/path/to/v8/`: Specify the path of an existing V8 clone. This
  will be used instead of cloning V8 to `baseDir`.
- `--verbose`: Enable verbose output.

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

## `git node wpt`

Update or patch the Web Platform Tests in core.
The updated files are placed under `./test/fixtures/wpt` by default. In addition
to the assets, this also updates:

- `./test/fixtures/wpt/versions.json`
- `./test/fixtures/wpt/README.md`
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
