'use strict';

const COMMIT_QUERY = 'LastCommit';
const TREE_QUERY = 'TreeEntries';
const { flatten } = require('../utils');

class GitHubTree {
  constructor(cli, request, argv) {
    this.cli = cli;
    this.request = request;

    this.owner = argv.owner;
    this.repo = argv.repo;
    this.branch = argv.branch;

    if (argv.path.endsWith('/')) {
      this.path = argv.path.slice(0, argv.path - 1);
    } else {
      this.path = argv.path;
    }

    this.lastCommit = argv.commit || null;
  }

  get repoUrl() {
    const base = 'https://github.com';
    const { owner, repo } = this;
    return `${base}/${owner}/${repo}`;
  }

  async _getLastCommit() {
    const { request, owner, repo, branch, path } = this;
    const data = await request.gql(COMMIT_QUERY, {
      owner,
      repo,
      branch,
      path
    });
    return data.repository.ref.target.history.nodes[0].oid;
  }

  /**
   * @returns {string} the hash of the last commit in the tree
   */
  async getLastCommit() {
    if (this.lastCommit) {
      return this.lastCommit;
    }
    this.lastCommit = await this._getLastCommit();
    return this.lastCommit;
  }

  getPermanentUrl() {
    if (!this.lastCommit) {
      throw new Error('Call await tree.getLastCommit() first');
    }
    const commit = this.lastCommit;
    return `${this.repoUrl}/tree/${commit.slice(0, 10)}/${this.path}`;
  }

  async text(assetPath) {
    await this.getLastCommit();
    const url = this.getAssetUrl(assetPath);
    return this.request.text(url);
  }

  /**
   * Get the url of an asset. If the assetPath starts with `/`,
   * it will be treated as an absolute path and the
   * the path of the tree will not be prefixed in the url.
   * @param {string} assetPath
   */
  getAssetUrl(assetPath) {
    if (!this.lastCommit) {
      throw new Error('Call await tree.getLastCommit() first');
    }
    const base = 'https://raw.githubusercontent.com';
    const { owner, repo, lastCommit, path } = this;
    const prefix = `${base}/${owner}/${repo}/${lastCommit}`;
    if (assetPath.startsWith('/')) {  // absolute
      return `${prefix}/${assetPath}`;
    } else {
      return `${prefix}/${path}/${assetPath}`;
    }
  }

  /**
   * Get a list of files inside the tree (recursively).
   * The returned file names will be relative to the path of the tree,
   * e.g. `url/resources/data.json` in a tree with `url` as path
   * will be `resources/data.json`
   *
   * @returns {{name: string, type: string}[]}
   */
  async getFiles(path) {
    if (!path) {
      path = this.path;
    }
    let lastCommit = this.lastCommit;
    if (!lastCommit) {
      lastCommit = await this.getLastCommit();
    }
    const { request, owner, repo } = this;

    const expression = `${lastCommit}:${path}`;
    this.cli.updateSpinner(`Querying files for ${path}`);
    const data = await request.gql(TREE_QUERY, {
      owner,
      repo,
      expression
    });
    const files = data.repository.object.entries;

    const dirs = files.filter((file) => file.type === 'tree');
    const nondirs = files.filter((file) => file.type !== 'tree');

    if (dirs.length) {
      const expanded = await Promise.all(
        dirs.map((dir) =>
          this.getFiles(`${path}/${dir.name}`)
            .then(files => files.map(
              ({ name, type }) => ({ name: `${dir.name}/${name}`, type })
            ))
        )
      );
      return nondirs.concat(flatten(expanded));
    } else {
      return nondirs;
    }
  }

  getCacheKey() {
    const { branch, owner, repo, path } = this;
    return `tree-${owner}-${repo}-${branch}-${clean(path)}`;
  }
}

function clean(path) {
  if (!path) {
    return '';
  }
  return path.replace('/', '-');
}

// Uncomment this when testing to avoid extra network costs
// const Cache = require('../cache');
// const treeCache = new Cache();

// treeCache.wrap(GitHubTree, {
//   _getLastCommit() {
//     return { key: `${this.getCacheKey()}-commit`, ext: '.json' };
//   },
//   getFiles(path) {
//     return {
//       key: `${this.getCacheKey()}-${clean(path)}-files`,
//       ext: '.json'
//     };
//   },
//   text(assetPath) {
//     return { key: `${this.getCacheKey()}-${clean(assetPath)}`, ext: '.txt' };
//   }
// });
// treeCache.enable();

module.exports = GitHubTree;
