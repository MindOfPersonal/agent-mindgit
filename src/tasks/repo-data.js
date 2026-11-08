'use strict';

const { isGitRepo, git } = require('../git/repo');

async function executeRepoDataTask(payload, runtime) {
  const { repoPath } = payload;
  const { gitCtx } = runtime;

  if (!isGitRepo(repoPath)) {
    return { success: true, gitData: { gitStatus: '', changedFiles: '', logEntries: '' } };
  }

  const statusResult = await git(repoPath, 'status --porcelain', gitCtx);
  const gitStatus = statusResult.success ? statusResult.stdout : '';

  const logResult = await git(repoPath, 'log --oneline -20', gitCtx);
  const logEntries = logResult.success ? logResult.stdout : '';

  let changedFiles = '';
  const head = await git(repoPath, 'rev-parse HEAD', gitCtx);
  if (head.success && head.stdout) {
    const parent = await git(repoPath, 'rev-parse HEAD~1', gitCtx);
    if (parent.success && parent.stdout) {
      const diff = await git(repoPath, `diff --name-status ${parent.stdout}..${head.stdout}`, gitCtx);
      if (diff.success) changedFiles = diff.stdout;
    }
    if (!changedFiles) {
      const staged = await git(repoPath, 'diff --name-status --staged', gitCtx);
      if (staged.success) changedFiles = staged.stdout;
      else {
        const unstaged = await git(repoPath, 'diff --name-status', gitCtx);
        if (unstaged.success) changedFiles = unstaged.stdout;
      }
    }
  } else {
    const cached = await git(repoPath, 'diff --cached --name-status', gitCtx);
    if (cached.success) changedFiles = cached.stdout;
  }

  return { success: true, gitData: { gitStatus, changedFiles, logEntries } };
}

module.exports = { executeRepoDataTask };
