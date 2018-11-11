'use strict';

const path = require('path');

const execa = require('execa');
const fs = require('fs-extra');
const inquirer = require('inquirer');
const Listr = require('listr');
const input = require('listr-input');

const common = require('./common');

exports.checkOptions = async function checkOptions(options) {
  if (options.sha.length > 1 && options.squash) {
    const { wantSquash } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantSquash',
      message: 'Squashing commits should be avoided if possible, because it ' +
        'can make git bisection difficult. Only squash commits if they would ' +
        'break the build when applied individually. Are you sure?',
      default: false
    }]);

    if (!wantSquash) {
      return true;
    }
  }
};

exports.doBackport = function doBackport(options) {
  const todo = [
    common.getCurrentV8Version(),
    generatePatches()
  ];

  if (options.squash) {
    todo.push(applyPatches());
    if (options.bump !== false) {
      if (options.nodeMajorVersion < 9) {
        todo.push(incrementV8Version());
      } else {
        todo.push(incrementEmbedderVersion());
      }
    }
    todo.push(commitSquashedBackport());
  } else {
    todo.push(applyAndCommitPatches());
  }

  return {
    title: 'V8 commit backport',
    task: () => {
      return new Listr(todo);
    }
  };
};

function commitSquashedBackport() {
  return {
    title: 'Commit backport',
    task: async(ctx) => {
      const { patches } = ctx;
      const messageTitle = formatMessageTitle(patches);
      let messageBody;
      if (patches.length === 1) {
        const [patch] = patches;
        messageBody = formatMessageBody(patch, false);
      } else {
        messageBody = '';
        for (const patch of patches) {
          const formatted = formatMessageBody(patch, true);
          messageBody += formatted + '\n\n';
        }
      }
      await ctx.execGitNode('add', 'deps/v8');
      await ctx.execGitNode('commit', '-m', messageTitle, '-m', messageBody);
    }
  };
};

function commitPatch(patch) {
  return {
    title: 'Commit patch',
    task: async(ctx) => {
      const messageTitle = formatMessageTitle([patch]);
      const messageBody = formatMessageBody(patch, false);
      await ctx.execGitNode('add', 'deps/v8');
      await ctx.execGitNode('commit', '-m', messageTitle, '-m', messageBody);
    }
  };
}

function shortSha(sha) {
  return sha.substring(0, 7);
}

function formatMessageTitle(patches) {
  const action =
    patches.some(patch => patch.hadConflicts) ? 'backport' : 'cherry-pick';
  if (patches.length === 1) {
    return `deps: V8: ${action} ${shortSha(patches[0].sha)}`;
  } else if (patches.length === 2) {
    return `deps: V8: ${action} ${shortSha(patches[0].sha)} and ${
      shortSha(patches[1].sha)
    }`;
  } else if (patches.length === 3) {
    return `deps: V8: ${action} ${shortSha(patches[0].sha)}, ${
      shortSha(patches[1].sha)
    } and ${shortSha(patches[2].sha)}`;
  } else {
    return `deps: V8: ${action} ${patches.length} commits`;
  }
}

function formatMessageBody(patch, prefixTitle) {
  const indentedMessage = patch.message.replace(/\n/g, '\n    ');
  const body =
    'Original commit message:\n\n' +
    `    ${indentedMessage}\n\n` +
    `Refs: https://github.com/v8/v8/commit/${patch.sha}`;

  if (prefixTitle) {
    const action = patch.hadConflicts ? 'Backport' : 'Cherry-pick';
    return `${action} ${shortSha(patch.sha)}.\n` + body;
  }
  return body;
}

function generatePatches() {
  return {
    title: 'Generate patches',
    task: async(ctx) => {
      const shas = ctx.sha;
      try {
        const fullShas = await Promise.all(
          shas.map(async(sha) => {
            const { stdout } = await ctx.execGitV8('rev-parse', sha);
            return stdout;
          })
        );
        ctx.patches = await Promise.all(fullShas.map(async(sha) => {
          const [patch, message] = await Promise.all([
            ctx.execGitV8('format-patch', '--stdout', `${sha}^..${sha}`),
            ctx.execGitV8('log', '--format=%B', '-n', '1', sha)
          ]);
          return {
            sha,
            data: patch.stdout,
            message: message.stdout
          };
        }));
      } catch (e) {
        throw new Error(e.stderr);
      }
    }
  };
}

function applyPatches() {
  return {
    title: 'Apply patches to deps/v8',
    task: async(ctx) => {
      const { patches } = ctx;
      for (const patch of patches) {
        await applyPatch(ctx, patch);
      }
    }
  };
}

function applyAndCommitPatches() {
  return {
    title: 'Apply and commit patches to deps/v8',
    task: (ctx) => {
      return new Listr(ctx.patches.map(applyPatchTask));
    }
  };
}

function applyPatchTask(patch) {
  return {
    title: `Commit ${shortSha(patch.sha)}`,
    task: (ctx) => {
      const todo = [
        {
          title: 'Apply patch',
          task: (ctx) => applyPatch(ctx, patch)
        }
      ];
      if (ctx.bump !== false) {
        if (ctx.nodeMajorVersion < 9) {
          todo.push(incrementV8Version());
        } else {
          todo.push(incrementEmbedderVersion());
        }
      }
      todo.push(commitPatch(patch));
      return new Listr(todo);
    }
  };
}

async function applyPatch(ctx, patch) {
  try {
    await execa(
      'patch',
      ['-p1', '--merge', '--no-backup-if-mismatch', '--directory=deps/v8'],
      {
        cwd: ctx.nodeDir,
        input: patch.data
      }
    );
  } catch (e) {
    patch.hadConflicts = true;
    return input("Resolve merge conflicts and enter 'RESOLVED'", {
      validate: value => value.toUpperCase() === 'RESOLVED'
    });
  }
}

function incrementV8Version() {
  return {
    title: 'Increment V8 version',
    task: async(ctx) => {
      const incremented = ++ctx.currentVersion[3];
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
