'use strict';

function getStartLTSBlurb({ date, ltsCodename, versionComponents }) {
  const dateFormat = { month: 'long', year: 'numeric' };
  // TODO pull these from the schedule.json in the Release repo?
  // Active LTS lasts for one year.
  const mainDate = new Date(date);
  mainDate.setMonth(mainDate.getMonth() + 12);
  const mainStart = mainDate.toLocaleString('en-US', dateFormat);
  // Maintenance LTS lasts another 18 months.
  const eolDate = new Date(mainStart);
  eolDate.setMonth(eolDate.getMonth() + 18);
  const eol = eolDate.toLocaleString('en-US', dateFormat);
  const { major } = versionComponents;
  return [
    /* eslint-disable max-len */
    `This release marks the transition of Node.js ${major}.x into Long Term Support (LTS)`,
    `with the codename '${ltsCodename}'. The ${major}.x release line now moves into "Active LTS"`,
    `and will remain so until ${mainStart}. After that time, it will move into`,
    `"Maintenance" until end of life in ${eol}.`
    /* eslint-enable */
  ].join('\n');
}

function updateTestProcessRelease(test, { versionComponents, ltsCodename }) {
  if (test.includes(ltsCodename)) {
    return test;
  }
  const inLines = test.split('\n');
  const outLines = [];
  const { major, minor } = versionComponents;
  for (const line of inLines) {
    if (line === '} else {') {
      outLines.push(`} else if (versionParts[0] === '${major}' ` +
                    `&& versionParts[1] >= ${minor}) {`
      );
      outLines.push(
        `  assert.strictEqual(process.release.lts, '${ltsCodename}');`
      );
    }
    outLines.push(line);
  }
  return outLines.join('\n');
}

module.exports = { getStartLTSBlurb, updateTestProcessRelease };
