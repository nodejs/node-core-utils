'use strict';

const Request = require('../lib/request');
const auth = require('../lib/auth');
const PRData = require('../lib/pr_data');
const PRQuery = require('../lib/pr_query');
const PRSummary = require('../lib/pr_summary');
const PRChecker = require('../lib/pr_checker');
const MetadataGenerator = require('../lib/metadata_gen');

const fs = require('fs');

async function getOneMetadata(argv, cli, request) {
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

  const checker = new PRChecker(cli, data, argv);
  const status = checker.checkAll(argv.checkComments);
  return {
    status,
    request,
    data,
    metadata,
    checker
  };
}

module.exports = async function getMetadata(argv, cli) {
  const credentials = await auth({
    github: true
  });
  const request = new Request(credentials);

  if (!argv.assignee) {
    return getOneMetadata(argv, cli, request);
  } else {
    // get all
    // Example: repo:nodejs/node is:pr is:open assignee:srl295
    const myQuery = new PRQuery(argv, cli, request);
    const prids = await myQuery.getPRs();
    for (const prid of prids) {
      cli.separator(`${prid}`);
      // new argv, with the prid
      const nargv = Object.assign({}, argv, { prid });
      delete nargv.assignee;
      await getOneMetadata(nargv, cli, request);
      cli.separator();
    }
    return {}; // ?
  }
};
