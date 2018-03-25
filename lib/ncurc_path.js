const path = require('path');
const os = require('os');

function getNcurcPath() {
  if (process.env.XDG_CONFIG_HOME !== 'undefined' &&
      process.env.XDG_CONFIG_HOME !== undefined) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ncurc');
  } else {
    return path.join(os.homedir(), '.ncurc');
  }
}

module.exports = getNcurcPath;
