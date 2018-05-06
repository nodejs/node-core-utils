'use strict';

const os = require('os');
const fetch = require('node-fetch');
const execa = require('execa');
const CLI = require('../../lib/cli');

const MIRRORS = {
  "nightly": "https://nodejs.org/download/nightly/",
  "v8-canary": "https://nodejs.org/download/v8-canary/",
}

module.exports = {
  command: 'bisect [command|script]',
  describe: '',
  builder: (yargs) => {
    yargs
    .option('from', {
        describe: '',
        demandOption: true
      })
      .option('to', {
        describe: '',
        default: "today"
      })
      .option('mirror', {
        describe: '',
        default: 'nightly'
      })
      .command({
        command: 'run-command <command>',
        desc: '',
        handler: handler,
      })
      .command({
        command: 'run-script <script>',
        desc: '',
        handler: handler,
        builder: (yargs) => {
          yargs.positional('script', {
            describe: ''
          });
        }
      })
      .demandCommand(1, 'Please provide a valid command');
  },
};

function getFileName() {
  switch (os.platform()) {
    case 'darwin':
      return `osx-${os.arch()}-tar`;
    case 'linux':
      return `linux-${os.arch()}`;
    default:
      return undefined;
  }
}

async function runCommandForBuild(cli, mirror, build, command) {
  const cmd = `source $NVM_DIR/nvm.sh &&
  export NVM_NODEJS_ORG_MIRROR=${mirror} &&
  nvm install ${build.version} &&
  export npm_config_nodedir=\\"$(dirname $(dirname $(which node)))/include/node\\" &&
  ${command}`;
  cli.startSpinner(`Installing '${build.version}' and running \`${command}\``);
  try {
    // const curlResult = await execa.shell(`/bin/bash -c ${cmd}`);
    const curlResult = await execa.shell(cmd, { shell: "/bin/bash" });
    cli.stopSpinner(`Test run on '${build.version}' finished`, curlResult.code == 0 ? CLI.SPINNER_STATUS.SUCCESS : CLI.SPINNER_STATUS.FAILED);
    return curlResult.code == 0;
  } catch(e) {
    cli.stopSpinner(`Test run on '${build.version}' finished`, CLI.SPINNER_STATUS.FAILED);
    return false;
  }
}

async function handler(argv) {
  const fromDate = new Date(argv.from);
  const toDate = argv.to == "today" ? new Date() : new Date(argv.to);
  const mirror = argv.mirror in MIRRORS ? MIRRORS[argv.mirror] : argv.mirror;
  const command = argv.command ? argv.command : `node ${argv.script}`;
  const fileName = getFileName();
  if (os == undefined) {
    throw Error("Cound't guess file name to download.");
  }

  console.log(`From Date: ${fromDate}`);
  console.log(`To Date: ${toDate}`);
  console.log(`Mirror: ${mirror}`);
  console.log(`Command: ${command}`);
  console.log(`File Name: ${fileName}`);

  const cli = new CLI(process.stderr);
  cli.startSpinner(`Downloading list of builds from ${mirror}`);

  const res = await fetch(`${mirror}/index.json`);
  const allBuilds = JSON.parse(await res.text());

  let toUseBuilds = [];

  for(let build of allBuilds) {
    const buildDate = (new Date(build.date));
    if (buildDate < fromDate || buildDate > toDate) {
      continue;
    }
    if (!build.files.includes(fileName)) {
      continue;
    }
    toUseBuilds.push(build);
  }

  toUseBuilds = toUseBuilds.sort((a, b) => {
    const x = new Date(a.date);
    const y = new Date(b.date);
    if (x < y) {return -1;}
    if (x > y) {return 1;}
    return 0;
  });

  cli.stopSpinner(`Bisecting: ${toUseBuilds.length} builds to test (roughly ${Math.ceil(Math.log(toUseBuilds.length)) + 3} steps)`);
  cli.info(`Test command will be \`${command}\``);
  if (!await cli.prompt("Do you want to start testing?")) {
    return false;
  }

  let min = 0;
  let max = toUseBuilds.length - 1;

  // First build: should succeed
  if (!await runCommandForBuild(cli, mirror, toUseBuilds[0], command)) {
    return false;
  }

  // Last build: should fail
  if (await runCommandForBuild(cli, mirror, toUseBuilds[toUseBuilds.length - 1], command)) {
    return false;
  }

  // Binary search for broken build

  while(min <= max) {
      let guess = Math.floor((max + min) / 2);

      if (await runCommandForBuild(cli, mirror, toUseBuilds[guess], command)) {
        min = guess + 1;
      }
      else {
        max = guess - 1;
      }
  }
  // -----

  return true;
}
