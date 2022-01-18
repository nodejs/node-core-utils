import { promises as fs } from 'node:fs';
import path from 'node:path';

import replace from 'replace-in-file';

const newDeprecationPattern =
/<\s*a id="DEP0([X]+[0-9]*)+"[^>]*><\s*\/\s*a>/g;

export async function getUnmarkedDeprecations() {
  const deprecationFilePath = path.resolve('doc', 'api', 'deprecations.md');
  const deprecationFile = await fs.readFile(deprecationFilePath, 'utf8');

  const unmarkedDeprecations = [
    ...deprecationFile.matchAll(newDeprecationPattern)
  ].map(m => m[1]);

  return unmarkedDeprecations;
}

export async function updateDeprecations(unmarkedDeprecations) {
  const deprecationPattern =
    /<\s*a id="DEP0([0-9]{3})+"[^>]*><\s*\/\s*a>/g;

  const deprecationFilePath = path.resolve('doc', 'api', 'deprecations.md');
  const deprecationFile = await fs.readFile(deprecationFilePath, 'utf8');

  const deprecationNumbers = [
    ...deprecationFile.matchAll(deprecationPattern)
  ].map(m => m[1]).reverse();

  // Pull highest deprecation number off the list and increment from there.
  let depNumber = parseInt(deprecationNumbers[0]) + 1;

  // Loop through each new unmarked deprecation number and replace instances.
  for (const unmarked of unmarkedDeprecations) {
    await replace({
      files: [
        'doc/api/*.md',
        'lib/**/*.js',
        'src/**/*.{h,cc}',
        'test/**/*.js'
      ],
      ignore: 'test/common/README.md',
      from: new RegExp(`DEP0${unmarked}`, 'g'),
      to: `DEP0${depNumber}`
    });

    depNumber++;
  }
}
