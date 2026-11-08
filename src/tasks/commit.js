'use strict';

const { git } = require('../git/repo');

async function executeCommitTask(payload, runtime) {
  const { repoPath, commit } = payload;
  const { gitCtx } = runtime;
  if (!commit) return { success: false, error: 'Missing commit' };

  const logResult = await git(repoPath, `log -1 --format=%H%n%an%n%ae%n%ad%n%s%n%b ${commit}`, gitCtx);
  if (!logResult.success || !logResult.stdout) return { success: false, error: 'Commit not found' };

  const lines = logResult.stdout.split('\n');
  const stat = await git(repoPath, `diff-tree --no-commit-id --name-status -r ${commit}`, gitCtx);
  const shortStat = await git(repoPath, `diff-tree --no-commit-id --shortstat -r ${commit}`, gitCtx);

  return {
    success: true,
    commit: {
      hash: lines[0] || '',
      author: lines[1] || '',
      email: lines[2] || '',
      date: lines[3] || '',
      subject: lines[4] || '',
      body: lines.slice(5).join('\n').trim(),
      files: stat.success ? stat.stdout.split('\n').filter(Boolean) : [],
      shortStat: shortStat.success ? shortStat.stdout.trim() : '',
    },
  };
}

module.exports = { executeCommitTask };
