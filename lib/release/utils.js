export function getEOLDate(ltsStartDate) {
  // Maintenance LTS lasts for 18 months.
  const result = getLTSMaintenanceStartDate(ltsStartDate);
  result.setMonth(result.getMonth() + 18);
  return result;
}

export function getLTSMaintenanceStartDate(ltsStartDate) {
  // Active LTS lasts for one year.
  const result = new Date(ltsStartDate);
  result.setMonth(result.getMonth() + 12);
  return result;
}

export function getStartLTSBlurb({ date, ltsCodename, versionComponents }) {
  const dateFormat = { month: 'long', year: 'numeric' };
  // TODO pull these from the schedule.json in the Release repo?
  const eolDate = getEOLDate(date);
  const eol = eolDate.toLocaleString('en-US', dateFormat);
  const { major } = versionComponents;
  return [
    `This release marks the transition of Node.js ${major}.x into Long Term Support (LTS)`,
    `with the codename '${ltsCodename}'. It will continue to receive updates through to`,
    `the end of ${eol}.`,
    '',
    'Other than updating metadata, such as the `process.release` object, to reflect',
    'that the release is LTS, no further changes since the previous release are',
    'included.'
  ].join('\n');
}

export function updateTestProcessRelease(test, options) {
  const { versionComponents, ltsCodename } = options;
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
