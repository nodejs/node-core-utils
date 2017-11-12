'use strict';

const Request = require('../lib/request');
const auth = require('../lib/auth');
const PRData = require('../lib/pr_data');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

const fs = require('fs');

module.exports = async function getMetadata(argv, cli) {
  const { prid, owner, repo } = argv;
  const credentials = await auth();
  const request = new Request(credentials);

  const data = new PRData(prid, owner, repo, cli, request);
  await data.getAll();

  cli.separator('PR info');
  data.logIntro();

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

  const checker = new PRChecker(cli, data, argv);
  const status = checker.checkAll(argv.checkComments);
  return {
    status,
    request,
    data,
    metadata,
    checker
  };
};
