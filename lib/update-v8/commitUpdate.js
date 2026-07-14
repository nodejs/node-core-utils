export default function commitUpdate() {
  return {
    title: 'Commit V8 update',
    task: async(ctx) => {
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
        message = `deps: patch V8 to ${ctx.newVersion}`;
      } else {
        message = `deps: update V8 to ${ctx.newVersion}`;
      }
      await ctx.execGitNode('commit', ['-m', message, ...moreArgs]);
    },
    skip: (ctx) => ctx.skipped
  };
};
