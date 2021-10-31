'use strict';

const { Listr } = require('listr2');

const backport = require('./backport');
const updateVersionNumbers = require('./updateVersionNumbers');
const commitUpdate = require('./commitUpdate');
const majorUpdate = require('./majorUpdate');
const minorUpdate = require('./minorUpdate');
const updateV8Clone = require('./updateV8Clone');

exports.major = function(options) {
  const tasks = new Listr(
    [updateV8Clone(), majorUpdate(), commitUpdate(), updateVersionNumbers()],
    getOptions(options)
  );
  return tasks.run(options);
};

exports.minor = function(options) {
  const tasks = new Listr(
    [updateV8Clone(), minorUpdate(), commitUpdate()],
    getOptions(options)
  );
  return tasks.run(options);
};

exports.backport = async function(options) {
  const shouldStop = await backport.checkOptions(options);
  if (shouldStop) return;
  const tasks = new Listr(
    [updateV8Clone(), backport.doBackport(options)],
    getOptions(options)
  );
  return tasks.run(options);
};

function getOptions(opts) {
  return {
    renderer: opts.verbose ? 'verbose' : 'default'
  };
}
