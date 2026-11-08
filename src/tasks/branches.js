'use strict';

const { getBranch, parseBranchList, git } = require('../git/repo');

async function executeBranchesTask(payload, runtime) {
  const { gitCtx } = runtime;
  const result = await git(payload.repoPath, 'branch -a', gitCtx);
  const branches = result.success ? parseBranchList(result.stdout) : [];
  const current = await getBranch(payload.repoPath, gitCtx);
  return { success: true, branches, current };
}

module.exports = { executeBranchesTask };
