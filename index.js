#!/usr/bin/env node
// MindDevelopment MindGit agent
'use strict';

const { main } = require('./src/cli');

main().catch((err) => {
  console.error('[FATAL]', err && err.stack ? err.stack : String(err));
  process.exit(1);
});
