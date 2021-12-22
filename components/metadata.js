import fs from 'node:fs';

import Request from '../lib/request.js';
import auth from '../lib/auth.js';
import PRData from '../lib/pr_data.js';
import PRSummary from '../lib/pr_summary.js';
import PRChecker from '../lib/pr_checker.js';
import MetadataGenerator from '../lib/metadata_gen.js';

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
  if (!process.stdout.isTTY) {
    process.stdout.write(metadata);
  }

  if (argv.file) {
    cli.separator();
    cli.startSpinner(`Writing metadata to ${argv.file}..`);
    fs.writeFileSync(argv.file, metadata);
    cli.stopSpinner(`Done writing metadata to ${argv.file}`);
  }

  cli.separator('Generated metadata');
  cli.write(metadata);
  cli.separator();

  const checker = new PRChecker(cli, data, request, argv);
  const status = await checker.checkAll(argv.checkComments, argv.checkCI);
  return {
    status,
    request,
    data,
    metadata,
    checker
  };
};
