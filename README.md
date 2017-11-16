# Node.js Core Utilities
[![npm](https://img.shields.io/npm/v/node-core-utils.svg?style=flat-square)](https://npmjs.org/package/node-core-utils)
[![Build Status](https://img.shields.io/travis/joyeecheung/node-core-utils.svg?style=flat-square)](https://travis-ci.org/joyeecheung/node-core-utils)
[![AppVeyor Build Status](https://img.shields.io/appveyor/ci/joyeecheung/node-core-utils/master.svg?style=flat-square&logo=appveyor)](https://ci.appveyor.com/project/joyeecheung/node-core-utils/history)
[![codecov](https://img.shields.io/codecov/c/github/joyeecheung/node-core-utils.svg?style=flat-square)](https://codecov.io/gh/joyeecheung/node-core-utils)
[![Known Vulnerabilities](https://snyk.io/test/github/joyeecheung/node-core-utils/badge.svg?style=flat-square)](https://snyk.io/test/github/joyeecheung/node-core-utils)

CLI tools for Node.js Core collaborators.

## Usage

```
npm install -g node-core-utils
```

After running any of the tools for the first-time, you will be asked to provide a
GitHub username and password in order to create a personal access token.

If you prefer not to provide your login credentials, [follow these instructions](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/)
to create the token.

Note: We need to read the email of the PR author in order to check if it matches
the email of the commit author. This requires checking the box `user:email` when
you create the personal access token (you can edit the permission later as well).

Then create a file named `.ncurc` under your `$HOME` directory (`~/.ncurc`);

```
{
  "username": "you_github_username",
  "token": "token_that_you_created"
}
```

If you would prefer to build from the source, install and link:

```
git clone git@github.com:joyeecheung/node-core-utils.git
cd node-core-utils
npm install
npm link
```

## `get-metadata`

This one is inspired by Evan Lucas's [node-review](https://github.com/evanlucas/node-review)
, although it is a CLI implemented with the Github GraphQL API.

```
get-metadata <identifier>

Retrieves metadata for a PR and validates them against nodejs/node PR rules

Options:
  --version         Show version number                                [boolean]
  --owner, -o       GitHub owner of the PR repository                   [string]
  --repo, -r        GitHub repository of the PR                         [string]
  --file, -f        File to write the metadata in                       [string]
  --check-comments  Check for 'LGTM' in comments                        [boolean]
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

### Features

- [x] Generate `PR-URL`
- [x] Generate `Reviewed-By`
- [x] Generate `Fixes`
- [x] Generate `Refs`
- [x] Check for CI runs
- [x] Check if commiters match authors
- [x] Check 48-hour wait
- [x] Check two TSC approval for semver-major
- [x] Warn new commits after reviews
- [ ] Check number of files changed (request pre-backport)

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

### License

MIT. See [LICENSE](./LICENSE).
