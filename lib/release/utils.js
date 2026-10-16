import semver from 'semver';

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
    `This release marks the transition of Node.js ${major}.x into Long Term Support (LTS)`,
    `with the codename '${ltsCodename}'. The ${major}.x release line now moves into "Active LTS"`,
    `and will remain so until ${mainStart}. After that time, it will move into`,
    `"Maintenance" until end of life in ${eol}.`
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

export function getAlphaVersionComponents(version) {
  const [tag, ...components] = version.prerelease;
  if (tag !== 'alpha' || components.length !== 3 ||
      !components.every(Number.isInteger) ||
      version.minor !== 0 || version.patch !== 0) {
    return null;
  }
  const [major, minor, patch] = components;
  return { major, minor, patch };
}

export function isAlphaReleaseLine(nodeVersionH) {
  return /^#define NODE_ALPHA_MAJOR_VERSION \d+$/m.test(nodeVersionH);
}

export function formatVersion({ major, minor, patch }, alphaVersionComponents) {
  const version = `${major}.${minor}.${patch}`;
  if (!alphaVersionComponents) return version;
  return `${version}-alpha.${formatVersion(alphaVersionComponents)}`;
}

export function updateNodeVersionForNextRelease(
  nodeVersionH, { versionComponents, alphaVersionComponents }) {
  const macro = alphaVersionComponents ? 'NODE_ALPHA_PATCH_VERSION' : 'NODE_PATCH_VERSION';
  const { patch } = alphaVersionComponents ?? versionComponents;
  return nodeVersionH
    .replace(new RegExp(`^#define ${macro} ${patch}$`, 'm'), `#define ${macro} ${patch + 1}`)
    .replace(/^#define NODE_VERSION_IS_RELEASE 1$/m, '#define NODE_VERSION_IS_RELEASE 0');
}

export function updateNodeVersionForNextMajor(nodeVersionH, major) {
  let updated = nodeVersionH
    .replace(/^#define NODE_MAJOR_VERSION \d+$/m, `#define NODE_MAJOR_VERSION ${major}`)
    .replace(/^#define NODE_MINOR_VERSION \d+$/m, '#define NODE_MINOR_VERSION 0')
    .replace(/^#define NODE_PATCH_VERSION \d+$/m, '#define NODE_PATCH_VERSION 0')
    .replace(/^#define NODE_VERSION_IS_RELEASE \d+$/m, '#define NODE_VERSION_IS_RELEASE 0')
    .replace(/^#define (NODE_ALPHA_\w+_VERSION) \d+$/gm, '#define $1 0');
  if (!isAlphaReleaseLine(updated)) {
    updated = updated.replace(/^#define NODE_VERSION_IS_RELEASE 0\n/m, [
      '#define NODE_VERSION_IS_RELEASE 0',
      '',
      '#define NODE_ALPHA_MAJOR_VERSION 0',
      '#define NODE_ALPHA_MINOR_VERSION 0',
      '#define NODE_ALPHA_PATCH_VERSION 0',
      ''
    ].join('\n'));
  }
  return updated;
}

export function incrementVersion(version, release) {
  const parsed = semver.parse(version);
  const alpha = parsed && getAlphaVersionComponents(parsed);
  if (!alpha) return semver.inc(version, release);
  return formatVersion(parsed, release === 'minor'
    ? { major: alpha.major, minor: alpha.minor + 1, patch: 0 }
    : { ...alpha, patch: alpha.patch + 1 });
}
