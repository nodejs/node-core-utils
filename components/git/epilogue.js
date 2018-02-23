'use strict';

module.exports = `Steps to land a pull request:
==============================================================================
$ cd path/to/node/project
$ git node land --abort          # Abort a landing session, just in case
$ git node land $PRID            # Start a new landing session

$ git rebase -i upstream/master  # Put "edit" on every commit that's gonna stay

$ git node land --amend          # Regenerate commit messages in HEAD
$ git rebase --continue          # Repeat until the rebase is done

$ git node land --final          # Verify all the commit messages
==============================================================================
Watch https://asciinema.org/a/148627 for a complete demo`;
