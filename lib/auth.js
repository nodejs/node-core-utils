'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const authFile = path.join(os.homedir(), '.ncurc');
// TODO: try-catch, validate properties
const { username, token } = JSON.parse(fs.readFileSync(authFile, 'utf8'));
const auth = Buffer.from(`${username}:${token}`).toString('base64');
module.exports = auth;
