import qs from 'node:querystring';

import {
  CI_DOMAIN,
  parseJobFromURL,
  CI_TYPES
} from './ci_type_parser.js';

export const statusType = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  ABORTED: 'ABORTED',
  UNSTABLE: 'UNSTABLE'
};

export function getPath(url) {
  return url.replace(`https://${CI_DOMAIN}/`, '').replace('api/json', '');
}

export function getNodeName(url) {
  const re = /\/nodes=(.+?)\//;
  if (re.test(url)) {
    return url.match(re)[1];
  }
  const parts = url.split('/');
  return parts[parts.length - 3];
}

export function fold(summary, code) {
  const dataBlock = '```\n' + code + '\n```';
  const summaryBlock = `\n<summary>${summary}</summary>\n`;
  return `<details>${summaryBlock}\n${dataBlock}\n</details>`;
}

export function pad(any, length) {
  return (any + '').padEnd(length);
}

export function markdownRow(...args) {
  let result = '';
  for (const item of args) {
    result += `| ${item} `;
  }
  return result + '|\n';
}

function filterBuild(builds, type) {
  return builds
    .filter(build => build.result === type)
    .map(build => parseJobFromURL(build.url));
}

export async function listBuilds(cli, request, type, since) {
  // assert(type === COMMIT || type === PR)
  const { jobName } = CI_TYPES.get(type);
  const tree = 'builds[url,result,timestamp]';
  const url = `https://${CI_DOMAIN}/job/${jobName}/api/json?tree=${qs.escape(tree)}`;

  cli.startSpinner(`Querying ${url}`);

  const result = await request.json(url);
  let builds = result.builds;
  if (since) {
    builds = builds.filter(build => build.timestamp > since);
  }
  const failed = filterBuild(builds, statusType.FAILURE);
  const aborted = filterBuild(builds, statusType.ABORTED);
  const pending = filterBuild(builds, null);
  const unstable = filterBuild(builds, statusType.UNSTABLE);
  const success = filterBuild(builds, statusType.SUCCESS);
  cli.stopSpinner('Done');

  return {
    success,
    failed,
    aborted,
    pending,
    unstable,
    count: builds.length
  };
}

export function getHighlight(f) {
  if (!f.reason) {
    f.reason = 'failure not found';
    return f.reason;
  }
  return f.reason.split('\n')[f.highlight]
    .replace(/not ok \d+ /, '')
    .replace(
      /JNLP4-connect connection from \S+/, 'JNLP4-connect connection from ...'
    )
    .replace(/FATAL: Could not checkout \w+/, 'FATAL: Could not checkout ...')
    .replace(
      /error: pathspec .+ did not match any file\(s\) known to git/,
      'error: pathspec ... did not match any file(s) known to git')
    .replace(
      /failed: no workspace for .+/,
      'failed: no workspace for ...'
    )
    .replace(
      /fatal: loose object \w+ \(stored in .git\/objects\/.+\) is corrupt/,
      'fatal: loose object ... (stored in .git/objects/...) is corrupt')
    .replace(/hudson\.plugins\.git\.GitException: /, '')
    .replace(/java\.io\.IOException: /, '');
}
