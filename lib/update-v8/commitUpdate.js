'use strict';

const util = require('./util');

module.exports = function() {
  return {
    title: 'Commit V8 update',
    task: async(ctx) => {
      const newV8Version = util.getNodeV8Version(ctx.nodeDir);
      await ctx.execGitNode('add', ['deps/v8']);
      const moreArgs = [];
      let message;
      if (ctx.minor) {
        const prev = ctx.currentVersion.toString();
        const next = ctx.latestVersion.join('.');
        moreArgs.push(
          '-m',
          `Refs: https://github.com/v8/v8/compare/${prev}...${next}`
        );
        message = `deps: patch V8 to ${newV8Version}`;
      } else {
        message = `deps: update V8 to ${newV8Version}`;
      }
      await ctx.execGitNode('commit', ['-m', message, ...moreArgs]);
    },
    skip: (ctx) => ctx.skipped
  };
};
