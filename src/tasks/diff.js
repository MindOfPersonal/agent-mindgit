'use strict';

const { git } = require('../git/repo');

async function executeDiffTask(payload, runtime) {
  const { repoPath, file } = payload;
  const { gitCtx } = runtime;
  if (!file) return { success: false, error: 'Missing file' };

  let diff = await git(repoPath, ['diff', 'HEAD', '--', file], gitCtx);
  if (!diff.success || !diff.stdout) {
    diff = await git(repoPath, ['diff', '--staged', '--', file], gitCtx);
  }
  return { success: true, diff: diff.success ? diff.stdout : '' };
}

module.exports = { executeDiffTask };
