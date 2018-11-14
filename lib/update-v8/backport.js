'use strict';

const path = require('path');

const execa = require('execa');
const fs = require('fs-extra');
const Listr = require('listr');
const input = require('listr-input');

const common = require('./common');

exports.doBackport = function doBackport(options) {
  const todo = [common.getCurrentV8Version(), generatePatch(), applyPatch()];
  if (options.bump !== false) {
    if (options.nodeMajorVersion < 9) {
      todo.push(incrementV8Version());
    } else {
      todo.push(incrementEmbedderVersion());
    }
  }
  return {
    title: 'V8 commit backport',
    task: () => {
      return new Listr(todo);
    }
  };
};

exports.commitBackport = function commitBackport() {
  return {
    title: 'Commit patch',
    task: async(ctx) => {
      const messageTitle = `deps: cherry-pick ${ctx.sha.substring(
        0,
        7
      )} from upstream V8`;
      const indentedMessage = ctx.message.replace(/\n/g, '\n    ');
      const messageBody =
        'Original commit message:\n\n' +
        `    ${indentedMessage}\n\n` +
        `Refs: https://github.com/v8/v8/commit/${ctx.sha}`;

      await ctx.execGitNode('add', 'deps/v8');
      await ctx.execGitNode('commit', '-m', messageTitle, '-m', messageBody);
    }
  };
};

function generatePatch() {
  return {
    title: 'Generate patch',
    task: async(ctx) => {
      const sha = ctx.sha;
      if (!sha || sha.length !== 40) {
        throw new Error(
          '--sha option is required and must be 40 characters long'
        );
      }
      try {
        const [patch, message] = await Promise.all([
          ctx.execGitV8('format-patch', '--stdout', `${sha}^..${sha}`),
          ctx.execGitV8('log', '--format=%B', '-n', '1', sha)
        ]);
        ctx.patch = patch.stdout;
        ctx.message = message.stdout;
      } catch (e) {
        throw new Error(e.stderr);
      }
    }
  };
}

function applyPatch() {
  return {
    title: 'Apply patch to deps/v8',
    task: async(ctx) => {
      const patch = ctx.patch;
      try {
        await execa('patch',
          ['-p1', '--merge', '--no-backup-if-mismatch', '--directory=deps/v8'],
          {
            cwd: ctx.nodeDir,
            input: patch
          });
      } catch (e) {
        return input("Resolve merge conflicts and enter 'RESOLVED'", {
          validate: value => value === 'RESOLVED'
        });
      }
    }
  };
}

function incrementV8Version() {
  return {
    title: 'Increment V8 version',
    task: async(ctx) => {
      const incremented = ctx.currentVersion[3] + 1;
      const versionHPath = `${ctx.nodeDir}/deps/v8/include/v8-version.h`;
      let versionH = await fs.readFile(versionHPath, 'utf8');
      versionH = versionH.replace(
        /V8_PATCH_LEVEL (\d+)/,
        `V8_PATCH_LEVEL ${incremented}`
      );
      await fs.writeFile(versionHPath, versionH);
    }
  };
}

const embedderRegex = /'v8_embedder_string': '-node\.(\d+)'/;
function incrementEmbedderVersion() {
  return {
    title: 'Increment embedder version number',
    task: async(ctx) => {
      const commonGypiPath = path.join(ctx.nodeDir, 'common.gypi');
      const commonGypi = await fs.readFile(commonGypiPath, 'utf8');
      const embedderValue = parseInt(embedderRegex.exec(commonGypi)[1], 10);
      const embedderString = `'v8_embedder_string': '-node.${embedderValue +
        1}'`;
      await fs.writeFile(
        commonGypiPath,
        commonGypi.replace(embedderRegex, embedderString)
      );
      await ctx.execGitNode('add', 'common.gypi');
    }
  };
}
