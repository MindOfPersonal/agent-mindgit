#!/usr/bin/env node
// Mindgit-agent
'use strict';

const { main } = require('./src/cli');

main().catch((err) => {
  console.error('[FATAL]', err && err.stack ? err.stack : String(err));
  process.exit(1);
});
