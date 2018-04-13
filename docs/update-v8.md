# update-v8

Update or patch the V8 engine in Node.js core.

## Usage

This tool will maintain a clone of the V8 repository in `~/.update-v8/v8`

### `update-v8 major`

* Replaces `deps/v8` with a newer major version.
* Resets the embedder version number to `-node.0`.
* Updates `NODE_MODULE_VERSION` according to the V8 version.

#### Options

##### `--branch=branchName`

Branch of the V8 repository to use for the upgrade.  
Defaults to `lkgr`.

### `update-v8 backport <sha>`

Fetches and applies the patch corresponding to `sha`. Increments the V8
embedder version number or patch version and commits the changes.  
If the `git apply` command fails, a patch file will be written in the Node.js
clone directory.

#### Options

##### `--no-bump`

Set this flag to skip bumping the V8 embedder version number or patch version.

### General options

#### `--node-dir=/path/to/node`

Specify the path to the Node.js git repository.  
Defaults to current working directory.

#### `--base-dir=/path/to/base/dir`

Specify the path where V8 the clone will be maintained.  
Defaults to `~/.update-v8`.

#### `--verbose`

Enable verbose output.
