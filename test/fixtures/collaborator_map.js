'use strict';
const fixtures = require('./');
const { Collaborator } = require('../../lib/collaborators');
const collabArr = fixtures.readJSON('collaborators.json');

collabArr.forEach((c) => {
  Object.setPrototypeOf(c, Collaborator.prototype);
});
const collaborators = new Map(
  collabArr.map((c) => [c.login.toLowerCase(), c])
);

module.exports = collaborators;
