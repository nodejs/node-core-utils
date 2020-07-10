function getNodeName(url) {
  const re = /\/nodes=(.+?)\//;
  if (re.test(url)) {
    return url.match(re)[1];
  }
  const parts = url.split('/');
  return parts[parts.length - 3];
}

function fold(summary, code) {
  const dataBlock = '```\n' + code + '\n```';
  const summaryBlock = `\n<summary>${summary}</summary>\n`;
  return `<details>${summaryBlock}\n${dataBlock}\n</details>`;
}

function pad(any, length) {
  return (any + '').padEnd(length);
}

const statusType = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  ABORTED: 'ABORTED',
  UNSTABLE: 'UNSTABLE'
};

module.exports = {
  fold,
  getNodeName,
  pad,
  statusType
};
