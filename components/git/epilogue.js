export default `Steps to land a pull request:
==============================================================================
$ cd path/to/node/project

# If you have not configured it before
$ ncu-config set upstream <name-of-remote-to-nodejs/node>
$ ncu-config set branch master   # Assuming you are landing commits on master

$ git checkout master
$ git node land --abort          # Abort a landing session, just in case
$ git node land $PRID            # Start a new landing session
$ git node land $URL             # Start a new landing session using the PR URL

# Follow instructions provided.

$ git node land --final          # Verify all the commit messages
==============================================================================
Watch https://asciinema.org/a/148627 for a complete demo`;
