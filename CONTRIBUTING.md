# Contributing to node-core-utils

This document will guide you through the contribution process.

### Step 1: Fork

Fork the project [on GitHub](https://github.com/nodejs/node-core-utils)
and check out your copy locally.

```bash
$ git clone git@github.com:username/node-core-utils.git
$ cd node-core-utils
$ git remote add upstream git@github.com:nodejs/node-core-utils.git
```

#### Which branch?

For developing new features and bug fixes, the `master` branch should be pulled
and built upon.

### Step 2: Branch

Create a feature branch and start hacking:

```bash
$ git checkout -b my-feature-branch -t origin/my-feature-branch
```

### Step 3: Commit

Make sure git knows your name and email address:

```bash
# In the project directory
$ git config user.name "J. Random User"
$ git config user.email "j.random.user@example.com"
```

Writing good commit logs is important. A commit log should describe what
changed and why. Follow these guidelines when writing one:

1. The first line should be a short description of the change
  (e.g. "get-metadata: check if the committer matches the author").
2. Keep the second line blank.
3. Wrap all lines at 72 columns.

The header line should be meaningful; it is what other people see when they
run `git shortlog` or `git log --oneline`.

If your patch fixes an open issue, you can add a reference to it at the end
of the log. Use the `Fixes:` prefix and the full issue URL. For example:

```
Fixes: https://github.com/nodejs/node-core-utils/issues/1
```

### Step 4: Rebase

Use `git rebase` (not `git merge`) to sync your work from time to time.

```bash
$ git checkout my-feature-branch
$ git fetch upstream
$ git rebase upstream/master
```

### Step 5: Test

Bug fixes and features should come with tests. Add your tests in the
`test` directory. The general rule is, if the test does not need to send
any requests to external servers, put it in `test/unit`. Otherwise put it
in `test/intergration`. Test fixtures should be placed in `test/fixtures`.

```bash
$ npm install
# To run the unit tests
$ npm test
# To run all the tests
$ npm run test-all
```

Make sure the linter is happy and that all tests pass before submitting a
pull request.

### Step 6: Push

```bash
$ git push origin my-feature-branch
# Or if you have pushed before and have rebased after that,
# do git push --force origin my-feature-branch instead
```

Go to https://github.com/yourusername/node-core-utils and
select your feature branch. Click the 'Pull Request' button
and fill out the form.

Pull requests are usually reviewed within a few days. If there are comments
to address, apply your changes in a separate commit and push that to your
feature branch. Post a comment in the pull request afterwards.

## Code of Conduct

We follow the
[Node.js Code of Conduct](https://github.com/nodejs/admin/blob/master/CODE_OF_CONDUCT.md)
in this project.

## Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

* (a) The contribution was created in whole or in part by me and I
  have the right to submit it under the open source license
  indicated in the file; or

* (b) The contribution is based upon previous work that, to the best
  of my knowledge, is covered under an appropriate open source
  license and I have the right under that license to submit that
  work with modifications, whether created in whole or in part
  by me, under the same open source license (unless I am
  permitted to submit under a different license), as indicated
  in the file; or

* (c) The contribution was provided directly to me by some other
  person who certified (a), (b) or (c) and I have not modified
  it.

* (d) I understand and agree that this project and the contribution
  are public and that a record of the contribution (including all
  personal information I submit with it, including my sign-off) is
  maintained indefinitely and may be redistributed consistent with
  this project or the open source license(s) involved.
