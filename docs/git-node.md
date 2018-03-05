# git-node

A custom Git command for managing pull requests. You can run it as
`git-node` or `git node`. To see the help text, run `git node`.

## Prerequistes

1. See the readme on how to
  [set up credentials](../README.md#setting-up-credentials).
1. It's a Git command, so make sure you have Git installed, of course.
1. Configure your upstream remote and branch name.
   ```
   $ cd path/to/node/project
   $ ncu-config set upstream your-remote-name
   $ ncu-config set branch your-branch-name
   ```

## Demo & Usage

1. Landing multiple commits: https://asciinema.org/a/148627
2. Landing one commit: https://asciinema.org/a/157445

```
Steps to land a pull request:
==============================================================================
$ cd path/to/node/project

# If you have not configured it before
$ ncu-config set upstream <name-of-remote-to-nodejs/node>
$ ncu-config set branch master   # Assuming you are landing commits on master

$ git checkout master
$ git node land --abort          # Abort a landing session, just in case
$ git node land $PRID            # Start a new landing session

$ git rebase -i upstream/master  # Put "edit" on every commit that's gonna stay

$ git node land --amend          # Regenerate commit messages in HEAD
$ git rebase --continue          # Repeat until the rebase is done

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

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

### `git node land`

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

Examples:
  git node land 12344       Land https://github.com/nodejs/node/pull/12344 in
                            the current directory
  git node land --abort     Abort the current session
  git node land --amend     Append metadata to the current commit message
  git node land --final     Verify the landed PR and clean up
  git node land --continue  Continue the current landing session
```

### `git node metadata`

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

#### Git bash for Windows

If you are using `git bash` and having trouble with output use
`winpty git-node.cmd metadata $PRID`.

current known issues with git bash:
- git bash Lacks colors.
- git bash output duplicates metadata.
