import _ from 'lodash';
import { createWriteStream } from 'node:fs';
import { appendFile, open, rename } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// assume 3 is the number of pr in which a test has failed to consider it flaky
const FLAKY_TEST_PR_THRESHOLD = 5;

export async function markFlakyTests(aggregation) {
  try {
    const tests = getFlakyTests(aggregation);
    // group tests by type (ex: parallel, pummel)
    const groupedByType = _.groupBy(tests, ({ file }) => file.split('/', 1));

    for (const [type, failedTests] of Object.entries(groupedByType)) {
      await editStatusFile(type, failedTests);
    }
  } catch (error) {
    console.error(error);
  }
};

export function getFlakyTests(aggregation) {
  const failedRuns = [];
  const { JS_TEST_FAILURE } = aggregation;

  for (const failedTest of JS_TEST_FAILURE) {
    const { failures, prs } = failedTest;

    // if test has failed in less than x pr do not consider it flaky
    if (!failures || prs.length < FLAKY_TEST_PR_THRESHOLD) continue;

    for (const failure of failures) {
      const { builtOn, file } = failure;
      if (!builtOn) continue;
      const { system, architecture } = parseSystemArchitecture(builtOn);
      failedRuns.push({
        builtOn,
        file,
        system,
        architecture,
        written: false
      });
    }
  }

  return failedRuns;
}

function matchSystem(rawSystem) {
  let system;
  switch (true) {
    case rawSystem.includes('container'):
      system = 'docker';
      break;
    case rawSystem.includes('win'):
      system = 'win32';
      break;
    case rawSystem.includes('fedora'):
    case rawSystem.includes('ubuntu'):
    case rawSystem.includes('rhel'):
    case rawSystem.includes('debian'):
      system = 'linux';
      break;
    case rawSystem.includes('macos'):
      system = 'macos';
      break;
    case rawSystem.includes('solaris'):
    case rawSystem.includes('smartos'):
      system = 'solaris';
      break;
    case rawSystem.includes('freebsd'):
      system = 'freebsd';
      break;
    case rawSystem.includes('aix72'):
      system = 'aix';
      break;
    default:
      system = rawSystem;
      break;
  }

  return system;
}

function matchArchitecture(rawArchitecture) {
  let architecture;
  switch (true) {
    case rawArchitecture.includes('arm64'):
      architecture = 'arm64';
      break;
    case rawArchitecture.includes('arm'):
      architecture = 'arm';
      break;
    case rawArchitecture.includes('s390x'):
    case rawArchitecture.includes('ppc64'):
      architecture = 'ibm';
      break;
    default:
      architecture = rawArchitecture;
      break;
  }
  return architecture;
}

function parseSystemArchitecture(builtOn) {
  const buildInfos = builtOn.split('-');
  const rawArchitecture = buildInfos[buildInfos.length - 2]; // second last element is architecture
  const rawSystem = buildInfos[buildInfos.length - 3]; // third last element is os

  return {
    architecture: matchArchitecture(rawArchitecture),
    system: matchSystem(rawSystem)
  };
}

async function editStatusFile(type, failedTests) {
  try {
    const testsGroupedByHeader = _.groupBy(failedTests,
      (f) => `[$system==${f.system} && $arch==${f.architecture}]`);
    // assume the .status file exists
    const fileName = `./test/${type}/${type}.status`;
    const tmpFile = `${fileName}.tmp`;
    const file = await open(fileName);

    await pipeline(
      file.readLines(),
      new FlakyTestTransfrom(testsGroupedByHeader),
      createWriteStream(tmpFile) // write output on a temp file
    );

    // if the header was not present we append it at the end of the file
    await appendTestsWithNewHeader(tmpFile, testsGroupedByHeader);

    // replace original file with tmp
    await rename(tmpFile, fileName);
  } catch (error) {
    // file might not exist or error was not parsable
    console.error(error);
  }
}

function generateSkipFileLine(file) {
  // take only filename without ex: /parallel/
  const filename = file.split('/')[1];
  return `${filename}: PASS, FLAKY`;
}

function appendTestsWithNewHeader(tmpFile, testsGroupedByHeader) {
  const text = [];

  for (const [header, failedTests] of Object.entries(testsGroupedByHeader)) {
    // skip if there isnt at least one failedTest with written false or no failedTests
    if (!failedTests?.length || !failedTests.some(f => f.written === false)) continue;

    // add space on top of header
    text.push(header);

    // add test lines in a set to avoid duplicates
    const newLines = new Set();
    for (const failedTest of failedTests) {
      // skip tests we have already been written because we found the header
      if (failedTest.written) continue;
      newLines.add(generateSkipFileLine(failedTest.file));
    }
    text.push(...newLines);
  }

  return appendFile(tmpFile, text.join('\n'));
}

class FlakyTestTransfrom extends Transform {
  constructor(testsGroupedByHeader) {
    super();
    this.testsGroupedByHeader = testsGroupedByHeader;
    this.bufferedLines = [];
  }

  _transform(chunk, _encoding, callback) {
    const chunkStringified = chunk.toString();

    const isHeader = chunkStringified.startsWith('[');

    if (
      // if its an empty line, passthrough
      chunkStringified === '' ||
      // if its not a header and we are not buffering, passthrough
      (!isHeader && !this.bufferedLines.length) ||
      // if its a header and not mapped, passthrough
      (isHeader && !(chunkStringified in this.testsGroupedByHeader))
    ) {
      callback(null, chunkStringified + '\n');
      return;
      ;
    }

    // not a header but a line (ex: test-tls-client-mindhsize: PASS, FLAKY)
    if (!isHeader) {
      this.bufferedLines.push(chunkStringified + '\n');
      callback();
      return;
    }

    // when we hit a new header, flush bufferedLines and reset
    this.push(this.bufferedLinesToString());
    this.bufferedLines = [];

    this.bufferedLines.push(chunkStringified + '\n');

    for (const failedTest of this.testsGroupedByHeader[chunkStringified]) {
      // set written to true because we are buffering it
      failedTest.written = true;
      const skipFileLine = generateSkipFileLine(failedTest.file);
      this.bufferedLines.push(skipFileLine + '\n');
    }

    callback();
  }

  bufferedLinesToString() {
    return _.uniq(this.bufferedLines).join('');
  }

  _flush(callback) {
    // Flush any remaining buffered lines
    callback(null, this.bufferedLinesToString());
  }
}
