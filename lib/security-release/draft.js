import fs from 'node:fs';
import path from 'node:path';

import { NEXT_SECURITY_RELEASE_FOLDER } from './security-release.js';
import { prepareSecurityRelease } from './preparation.js';

export function getSecurityReleaseDraftPath(directory) {
  if (typeof directory !== 'string' || !directory.trim()) {
    throw new Error('Security release repository directory is required');
  }
  return path.resolve(directory, NEXT_SECURITY_RELEASE_FOLDER, 'vulnerabilities.json');
}

export function assertNewSecurityRelease(directory) {
  const file = getSecurityReleaseDraftPath(directory);
  if (fs.existsSync(file)) {
    throw new Error(
      `Security release draft already exists: ${file}. ` +
      'Use --sync, --add-report, or --remove-report to update the existing release.'
    );
  }
}

// Local persistence only. The caller handles review, Git, and publication.
export function writeSecurityReleaseDraft(directory, draft) {
  const { release } = prepareSecurityRelease(draft);
  const file = getSecurityReleaseDraftPath(directory);
  assertNewSecurityRelease(directory);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(release, null, 2) + '\n', { flag: 'wx' });
  return file;
}
