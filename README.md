# Node.js Core Utilities
[![npm](https://img.shields.io/npm/v/node-core-utils.svg?style=flat-square)](https://npmjs.org/package/node-core-utils)
[![Build Status](https://img.shields.io/travis/nodejs/node-core-utils.svg?style=flat-square)](https://travis-ci.org/nodejs/node-core-utils)
[![AppVeyor Build Status](https://img.shields.io/appveyor/ci/joyeecheung/node-core-utils/master.svg?style=flat-square&logo=appveyor)](https://ci.appveyor.com/project/nodejs/node-core-utils/history)
[![codecov](https://img.shields.io/codecov/c/github/nodejs/node-core-utils.svg?style=flat-square)](https://codecov.io/gh/nodejs/node-core-utils)
[![Known Vulnerabilities](https://snyk.io/test/github/nodejs/node-core-utils/badge.svg?style=flat-square)](https://snyk.io/test/github/nodejs/node-core-utils)

CLI tools for Node.js Core collaborators.

<!-- TOC -->

- [Tools](#tools)
- [Usage](#usage)
  - [Install](#install)
  - [Setting up credentials](#setting-up-credentials)
  - [Make sure your credentials won't be committed](#make-sure-your-credentials-wont-be-committed)
- [Contributing](#contributing)
- [License](#license)

<!-- /TOC -->

## Tools

- [`git-node`](./docs/git-node.md): Custom Git commands for working with Node.js
  core, e.g. landing Pull Requests.
- [`ncu-config`](./docs/ncu-config.md): Configure variables for node-core-utils
  to use.
- [`ncu-team`](./docs/ncu-team.md): Listing members of a team, synchronizing
  special blocks in files with the list of members.
- [`get-metadata`](./docs/get-metadata.md): Retrieving metadata for a Pull Request.
  **DEPRECATED**: use [`git node metadata`](./docs/git-node.md#git-node-metadata)
  instead.
- [`ncu-ci`](./docs/ncu-ci.md): Parse the results of a Jenkins CI run and display a summary for all the failures.

## Usage

### Install

```
npm install -g node-core-utils
```

If you would prefer to build from the source, install and link:

```
git clone git@github.com:nodejs/node-core-utils.git
cd node-core-utils
npm install
npm link
```

### Setting up credentials

Most of the tools need your GitHub credentials to work. You can either

1. Run any of the tools and you will be asked in a prompt to provide your
  username and password in order to create a personal access token.
2. Or, create a personal access token yourself on GitHub, then set them up
  using an editor.


If you prefer option 2, [follow these instructions](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/)
to create the token.

When creating the token, the following boxes need to be checked:

- `user:email`: Used by `git-node` and `get-metadata` to read the email of the
  PR author in order to check if it matches the email of the commit author.
- `read:org`: Used by `ncu-team` to read the list of team members.

You can also edit the permission of existing tokens later.

After the token is generated, create an rc file with the following content:
(`~/.ncurc` or `$XDG_CONFIG_HOME/ncurc`):

```json
{
  "username": "your_github_username",
  "token": "token_that_you_created"
}
```

Note: you could use `ncu-config` to configure these variables, but it's not
recommended to leave your tokens in your command line history.

### Make sure your credentials won't be committed

Put the following entries into `~/.gitignore_global`

```
.ncurc  # node-core-utils configuration file
.ncu    # node-core-utils working directory
```

Mind that`.ncu/land` could contain your access token since it contains the
serialized configurations.

If you ever accidentally commit your access token on GitHub, you can simply
revoke that token and use a new one.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
