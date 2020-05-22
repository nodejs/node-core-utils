'use strict';

const Request = require('../lib/request');
const auth = require('../lib/auth');
const PRData = require('../lib/pr_data');
const PRSummary = require('../lib/pr_summary');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

const fs = require('fs');

module.exports = async function getMetadata(argv, cli) {
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

  const metadata = new MetadataGenerator(data).getMetadata();
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
  const status = await checker.checkAll(argv.checkComments);
  return {
    status,
    request,
    data,
    metadata,
    checker
  };
};
