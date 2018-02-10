# git-node

A custom Git command for managing pull requests. You can run it as
`git-node` or `git node`. To see the help text, run `git node help`.

### Prerequistes

1. It's a Git command, so make sure you have Git installed, of course.
2. Install [core-validate-commit](https://github.com/nodejs/core-validate-commit)

    ```
    $ npm install -g core-validate-commit
    ```
3. Configure your upstream remote and branch name. By default it assumes your
  remote pointing to https://github.com/nodejs/node is called `upstream`, and
  the branch that you are trying to land PRs on is `master`. If that's not the
  case:

    ```
    $ cd path/to/node/project
    $ ncu-config set upstream your-remote-name
    $ ncu-config set branch your-branch-name
    ```

### Demo & Usage

1. Landing multiple commits: https://asciinema.org/a/148627
2. Landing one commit: https://asciinema.org/a/157445

```
$ cd path/to/node/project
$ git node land --abort          # Abort a landing session, just in case
$ git node land $PRID            # Start a new landing session

$ git rebase -i upstream/master  # Put `edit` on every commit that's gonna stay

$ git node land --amend          # Regenerate commit messages in HEAD
$ git rebase --continue          # Repeat until the rebase is done

$ git node land --final          # Verify all the commit messages
```
