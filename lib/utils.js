import which from 'which';

import { forceRunAsync } from './run.js';

export function ascending(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

export function descending(a, b) {
  if (a === b) return 0;
  return a > b ? -1 : 1;
};

export function flatten(arr) {
  let result = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      result = result.concat(flatten(item));
    } else {
      result.push(item);
    }
  }
  return result;
}

export function shortSha(sha) {
  return sha.slice(0, 12);
};

let isGhAvailableCache;
export function isGhAvailable() {
  if (isGhAvailableCache === undefined) {
    isGhAvailableCache = which.sync('gh', { nothrow: true }) !== null;
  }
  return isGhAvailableCache;
};

/**
 * Returns the user's preferred text editor command.
 * @param {object} [options]
 * @param {boolean} [options.git] - Whether to try the GIT_EDITOR environment
 * variable or `git config`.
 * @returns {Promise<string|null>}
 */
export async function getEditor(options = {}) {
  const {
    git = false
  } = options;

  if (git) {
    if (process.env.GIT_EDITOR) {
      return process.env.GIT_EDITOR;
    }
    const out = await forceRunAsync(
      'git',
      ['config', 'core.editor'],
      { captureStdout: 'lines' }
    );
    if (out && out[0]) {
      return out[0];
    }
  }

  return process.env.VISUAL || process.env.EDITOR || null;
};

/**
 * Extracts the releasers' information from the provided markdown txt.
 * Each releaser's information includes their name, email, and GPG key.
 *
 * @param {string} txt - The README content.
 * @returns {Array<Array<string>>} An array of releaser information arrays.
 *                                 Each sub-array contains the name, email,
 *                                 and GPG key of a releaser.
 */
export function extractReleasersFromReadme(txt) {
  const regex = /\* \*\*(.*)\*\*.*<<(.*)>>\n.*`(.*)`/gm;
  let match;
  const result = [];
  while ((match = regex.exec(txt)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
    const [, name, email, key] = match;
    result.push([name, email, key]);
  }
  return result;
}

export function checkReleaserDiscrepancies(member, extractedMembers) {
  let releaseKey, extractedMember;
  member.keys.forEach(key => {
    extractedMembers.filter(eMember => {
      if (eMember[2].includes(key.key_id)) {
        extractedMember = eMember;
        releaseKey = key;
      }
    });
  });

  if (!extractedMember || !releaseKey) {
    console.error(`The releaser ${member.name} (${member.login}) is not listed or any of the current profile GPG keys are listed in README.md`);
    return;
  }

  if (!releaseKey.emails.some(({ email }) => email === extractedMember[1])) {
    console.error(`The releaser ${member.name} (${member.login}) has a key (${releaseKey.key_id}) that is not associated with their email address ${extractedMember[1]} in the README.md`);
  }

  if (!releaseKey.can_sign) {
    console.error(`The releaser ${member.name} (${member.login}) has a key (${releaseKey.key_id}) that cannot sign`);
  }

  if (!releaseKey.can_certify) {
    console.error(`The releaser ${member.name} (${member.login}) has a key (${releaseKey.key_id}) that cannot certify`);
  }

  if (!releaseKey.expires_at) {
    console.error(`The releaser ${member.name} (${member.login}) has a key (${releaseKey.key_id}) that cannot expire`);
  }

  if (releaseKey.revoked) {
    console.error(`The releaser ${member.name} (${member.login}) has a key (${releaseKey.key_id}) that has been revoked`);
  }
}
