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
  const mainDate = getLTSMaintenanceStartDate(date);
  const mainStart = mainDate.toLocaleString('en-US', dateFormat);
  const eolDate = getEOLDate(date);
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
