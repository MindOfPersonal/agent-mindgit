'use strict';

const { getBranch, hasUncommittedChanges, git } = require('../git/repo');

async function executeResolveConflictTask(payload, runtime) {
  const { repoPath, strategy } = payload;
  const { gitCtx } = runtime;
  const branch = await getBranch(repoPath, gitCtx);

  await git(repoPath, 'fetch origin', gitCtx, gitCtx.longTimeout);

  if (strategy === 'abort') {
    await git(repoPath, ['merge', '--abort'], gitCtx);
    return { success: true, aborted: true, current: await getBranch(repoPath, gitCtx) };
  }

  if (await hasUncommittedChanges(repoPath, gitCtx)) {
    await git(repoPath, ['add', '-A'], gitCtx);
    await git(repoPath, ['commit', '-m', 'auto-sync: resolve'], gitCtx);
  }

  const mergeResult = await git(
    repoPath,
    ['merge', '--allow-unrelated-histories', '-s', 'recursive', '-X', strategy, '--no-edit', `origin/${branch}`],
    gitCtx,
    gitCtx.longTimeout
  );

  if (!mergeResult.success) {
    const unmerged = await git(repoPath, 'diff --name-only --diff-filter=U', gitCtx);
    if (!unmerged.success || !unmerged.stdout) {
      await git(repoPath, ['merge', '--abort'], gitCtx);
      return { success: false, error: 'Could not auto-resolve conflict' };
    }

    for (const file of unmerged.stdout.split('\n').map((f) => f.trim()).filter(Boolean)) {
      const statusRes = await git(repoPath, ['status', '--porcelain', '--', file], gitCtx);
      const xy = String(statusRes.stdout || '').replace(/^\s*/, '').substring(0, 2);
      let resolved = false;
      if (strategy === 'ours') {
        if (xy[0] === 'D') resolved = (await git(repoPath, ['rm', file], gitCtx)).success;
        else resolved = (await git(repoPath, ['checkout', '--ours', '--', file], gitCtx)).success;
      } else {
        if (xy[1] === 'D') resolved = (await git(repoPath, ['rm', file], gitCtx)).success;
        else resolved = (await git(repoPath, ['checkout', '--theirs', '--', file], gitCtx)).success;
      }
      if (!resolved) {
        await git(repoPath, ['merge', '--abort'], gitCtx);
        return { success: false, error: `Could not resolve file: ${file}` };
      }
    }
    await git(repoPath, ['add', '-A'], gitCtx);
    const commit = await git(repoPath, ['commit', '-m', `auto-sync: resolve (${strategy})`], gitCtx);
    if (!commit.success) {
      await git(repoPath, ['merge', '--abort'], gitCtx);
      return { success: false, error: 'Could not commit resolution' };
    }
  }

  const pushResult = await git(repoPath, ['push', 'origin', branch], gitCtx, gitCtx.longTimeout);
  if (!pushResult.success) {
    return { success: false, error: 'Push failed after conflict resolution', details: pushResult.stderr };
  }

  return { success: true, current: await getBranch(repoPath, gitCtx), branch, strategy };
}

module.exports = { executeResolveConflictTask };
