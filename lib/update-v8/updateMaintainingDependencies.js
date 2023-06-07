import { promises as fs } from 'node:fs';
import { getNodeV8Version } from './util.js';

export default function updateMaintainingDependencies() {
  return {
    title: 'Update V8 version in maintaining-dependencies.md',
    task: async(ctx) => {
      const path = `${ctx.nodeDir}/doc/contributing/maintaining/maintaining-dependencies.md`;
      let maintainingDependenciesMd = await fs.readFile(path, 'utf8');
      const v8Version = (await getNodeV8Version(ctx.nodeDir)).toString();
      const v8VersionNoDots = v8Version.replaceAll('.', '');
      // V8 itemlist link
      maintainingDependenciesMd = maintainingDependenciesMd.replace(
        /\* \[V8.*/,
        `* [V8 ${v8Version}][]`
      );
      // V8 link to section
      maintainingDependenciesMd = maintainingDependenciesMd.replace(
        /\[v8.*\]: #v8.*/,
        `[v8 ${v8Version}]: #v8-${v8VersionNoDots}`
      );
      // V8 section title
      maintainingDependenciesMd = maintainingDependenciesMd.replace(
        /### V8.*/,
        `### V8 ${v8Version}`
      );
      await fs.writeFile(path, maintainingDependenciesMd);
      await ctx.execGitNode(
        'add',
        ['doc/contributing/maintaining/maintaining-dependencies.md']
      );
    }
  };
};
