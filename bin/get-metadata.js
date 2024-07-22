#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { runAsync } from '../lib/run.js';
import { setVerbosityFromEnv } from '../lib/verbosity.js';

setVerbosityFromEnv();

const script = fileURLToPath(new URL('git-node.js', import.meta.url));
runAsync(process.execPath, [script, 'metadata', ...process.argv.slice(2)]);
