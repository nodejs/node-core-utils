const { runAsync } = require('../../lib/run');
const { error, log } = require('./index');
const isUnix = process.platform !== 'win32';

let cmd = isUnix ? 'make' : 'vcbuild';
const args = [ 'lint' ];

function logLinterFailure() {
  error('ncu commit-linter:', 'linter test failed');
  error('ncu commit-linter:',
    'you can add -n or --no-verify flag to skip ncu commit linter');
}

log('ncu commit-linter:', 'running linter..');
runAsync(cmd, args)
  .then(() => {
    log('ncu commit-linter:', 'linter tests passed');
  })
  .catch(() => {
    logLinterFailure();
    process.exit(1);
  });

process.on('uncaughtException', () => {
  logLinterFailure();
  process.exit(1);
});
