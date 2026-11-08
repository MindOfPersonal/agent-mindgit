'use strict';

const { getBranch, git } = require('../git/repo');
const { friendlyGitError } = require('../git/runner');

async function executeSwitchBranchTask(payload, runtime) {
  const { repoPath, branch } = payload;
  const { gitCtx } = runtime;

  if (!branch) return { success: false, error: 'Missing branch' };

  const result = await git(repoPath, ['checkout', branch], gitCtx, gitCtx.longTimeout);
  if (!result.success) {
    return { success: false, error: friendlyGitError(result.stderr, `Failed to switch to ${branch}`), details: result.stderr };
  }
  const current = await getBranch(repoPath, gitCtx);
  return { success: true, current };
}

module.exports = { executeSwitchBranchTask };
