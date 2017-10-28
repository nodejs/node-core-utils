# Node.js Core Utilities
[![npm](https://img.shields.io/npm/v/node-core-utils.svg?style=flat-square)](https://npmjs.org/package/node-core-utils)
[![Build Status](https://travis-ci.org/joyeecheung/node-core-utils.svg?branch=master)](https://travis-ci.org/joyeecheung/node-core-utils)
[![codecov](https://codecov.io/gh/joyeecheung/node-core-utils/branch/master/graph/badge.svg)](https://codecov.io/gh/joyeecheung/node-core-utils)

CLI tools for Node.js Core collaborators

## Usage

First, [follow these instructions](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/)
to create a personal access token.

Note: You don't need to check any boxes, these tools only require public access(for now).

Then create a file named `.ncurc` under your `$HOME` directory (`~/.ncurc`);

```
{
  "username": "you_github_username"
  "token": "token_that_you_created"
}
```

If you install via npm, that's it.

If you are using it from source, install and link:

```
git clone git@github.com:joyeecheung/node-core-utils.git
cd node-core-utils
npm install
npm link
```

## `get-metadata`

This one is inspired by Evan Lucas's [node-review](https://github.com/evanlucas/node-review)
, although it is a CLI implemented with the Github GraphQL API.

### TODO

- [x] Generate `PR-URL`
- [x] Generate `Reviewed-By`
- [x] Generate `Fixes`
- [x] Generate `Refs`
- [x] Check for CI runs
- [ ] Check if commiters match authors
  - Only when `"authorAssociation": "FIRST_TIME_CONTRIBUTOR"`
- [x] Check 48-hour wait
- [x] Check two TSC approval for semver-major
- [ ] Warn new commits after reviews
- [ ] Check number of files changed (request pre-backport)
