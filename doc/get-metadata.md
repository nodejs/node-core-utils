# get-metadata

This tool is inspired by Evan Lucas's [node-review](https://github.com/evanlucas/node-review),
although it is a CLI implemented with the GitHub GraphQL API.

```
get-metadata <identifier>

Retrieves metadata for a PR and validates them against nodejs/node PR rules

Options:
  --version         Show version number                                [boolean]
  --owner, -o       GitHub owner of the PR repository                   [string]
  --repo, -r        GitHub repository of the PR                         [string]
  --file, -f        File to write the metadata in                       [string]
  --check-comments  Check for 'LGTM' in comments                       [boolean]
  --max-commits     Number of commits to warn              [number] [default: 3]
  --help, -h        Show help                                          [boolean]
```

Examples:

```bash
PRID=12345

# fetch metadata and run checks on nodejs/node/pull/$PRID
$ get-metadata $PRID
# is equivalent to
$ get-metadata https://github.com/nodejs/node/pull/$PRID
# is equivalent to
$ get-metadata $PRID -o nodejs -r node

# Or, redirect the metadata to a file while see the checks in stderr
$ get-metadata $PRID > msg.txt

# Using it to amend commit messages:
$ get-metadata $PRID -f msg.txt
$ echo -e "$(git show -s --format=%B)\n\n$(cat msg.txt)" > msg.txt
$ git commit --amend -F msg.txt
```

### Git bash for Windows
If you are using `git bash` and having trouble with output use `winpty get-metadata.cmd $PRID`.

current known issues with git bash:
- git bash Lacks colors.
- git bash output duplicates metadata.

### Features

- [x] Generate `PR-URL`
- [x] Generate `Reviewed-By`
- [x] Generate `Fixes`
- [x] Generate `Refs`
- [x] Check for CI runs
- [x] Check if committers match authors
- [x] Check 48-hour wait
- [x] Check two TSC approval for semver-major
- [x] Warn new commits after reviews
- [ ] Check number of files changed (request pre-backport)
