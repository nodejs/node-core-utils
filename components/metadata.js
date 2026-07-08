import fs from 'node:fs';

import Request from '../lib/request.js';
import auth from '../lib/auth.js';
import PRData from '../lib/pr_data.js';
import PRSummary from '../lib/pr_summary.js';
import PRChecker, {
  PR_CHECK_REASON_CODES
} from '../lib/pr_checker.js';
import MetadataGenerator from '../lib/metadata_gen.js';

export const METADATA_READINESS = Object.freeze({
  READY: 'ready',
  DEFERRABLE: 'deferrable',
  FAILED: 'failed'
});

export const METADATA_EXIT_CODES = Object.freeze({
  READY: 0,
  DEFERRABLE: 20,
  FAILED: 40
});

const DEFERRABLE_REASON_CODES = new Set([
  PR_CHECK_REASON_CODES.WAIT_TIME
]);

export function classifyMetadataReadiness(ready, reasonCodes) {
  if (ready) {
    return METADATA_READINESS.READY;
  }

  if (reasonCodes.length > 0 &&
      reasonCodes.every((code) => DEFERRABLE_REASON_CODES.has(code))) {
    return METADATA_READINESS.DEFERRABLE;
  }

  return METADATA_READINESS.FAILED;
}

export function getMetadataExitCode(readiness) {
  switch (readiness) {
    case METADATA_READINESS.READY:
      return METADATA_EXIT_CODES.READY;
    case METADATA_READINESS.DEFERRABLE:
      return METADATA_EXIT_CODES.DEFERRABLE;
    default:
      return METADATA_EXIT_CODES.FAILED;
  }
}

export function formatMetadataResult({ status, data, metadata, checker }) {
  const reasonCodes = [...new Set(checker.reasons.map(({ code }) => code))];
  const readiness = classifyMetadataReadiness(status, reasonCodes);
  const exitCode = getMetadataExitCode(readiness);
  return {
    ready: status,
    readiness,
    exitCode,
    pullRequest: {
      owner: data.owner,
      repo: data.repo,
      number: data.prid,
      url: data.pr.url
    },
    metadata,
    reasonCodes,
    reasons: checker.reasons
  };
}

export async function getMetadata(argv, skipRefs, cli) {
  const credentials = await auth({
    github: true,
    jenkins: true
  });
  const request = new Request(credentials);

  const data = new PRData(argv, cli, request);
  await data.getAll();

  const summary = new PRSummary(argv, cli, data);
  cli.separator('PR info');
  summary.display();

  const metadata = new MetadataGenerator({ skipRefs, ...data }).getMetadata();
  if (!argv.json && !process.stdout.isTTY) {
    process.stdout.write(metadata);
  }

  if (argv.file) {
    cli.separator();
    cli.startSpinner(`Writing metadata to ${argv.file}..`);
    fs.writeFileSync(argv.file, metadata);
    cli.stopSpinner(`Done writing metadata to ${argv.file}`);
  }

  if (!argv.json) {
    cli.separator('Generated metadata');
    cli.write(metadata);
    cli.separator();
  }

  const checker = new PRChecker(cli, data, request, argv);
  const status = await checker.checkAll(argv.checkComments, argv.checkCI);
  const result = {
    status,
    request,
    data,
    metadata,
    checker
  };
  return {
    ...result,
    json: formatMetadataResult(result)
  };
};
