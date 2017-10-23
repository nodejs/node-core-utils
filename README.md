# Node.js Core Utilities

## Usage

First, [follow these instructions](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/)
to create a personal access token.

Then create a file named `.ncurc` under your `$HOME` directory (`~/.ncurc`);

```
{
  "username": "joyeecheung",
  "token": "token_that_you_created"
}
```

Install and link ():

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
- [ ] Generate `Fixes`
- [ ] Generate `Refs`
- [ ] Check for CI runs
- [ ] Check if commiters match authors
- [ ] Check 48-hour wait
- [ ] Check two TSC approval for semver-major
- [ ] Check number of files changed (request pre-backport)
