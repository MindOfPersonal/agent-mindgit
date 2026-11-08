'use strict';

const {
  ensureRepoPresent,
  configureIdentity,
  getBranch,
  hasUncommittedChanges,
  countCommits,
  getRepoStatusInternal,
  git,
} = require('../git/repo');
const { friendlyGitError } = require('../git/runner');
const { TaskAction } = require('../../lib/agent-protocol');

/**
 * Sync/clone/fetch/pull/push. Respecteert syncDirection (bidirectional|push|pull).
 * @returns {Promise<{success:boolean, status?:object, logs:Array, error?:string, details?:string}>}
 */
async function executeSyncTask(payload, runtime) {
  const { repoId, repoPath, commitMessage, action, syncDirection } = payload;
  const { gitCtx, emitProgress, config } = runtime;
  const logs = [];

  const emit = (msg, type = 'info') => {
    logs.push({ msg, type, timestamp: Date.now() });
    emitProgress(msg, type);
  };

  try {
    const prep = await ensureRepoPresent(payload, emit, gitCtx);
    if (prep) return { success: false, ...prep, logs };

    await configureIdentity(repoPath, gitCtx, config.gitUserName, config.gitUserEmail);

    const branch = await getBranch(repoPath, gitCtx);

    const doFetch = [TaskAction.SYNC, TaskAction.FETCH, TaskAction.CLONE].includes(action);
    const doPull = [TaskAction.SYNC, TaskAction.PULL, TaskAction.CLONE].includes(action) && syncDirection !== 'push';
    const doPush = [TaskAction.SYNC, TaskAction.PUSH, TaskAction.CLONE].includes(action) && syncDirection !== 'pull';

    if (doFetch) {
      emit('Fetching from origin...', 'info');
      const fetchResult = await git(repoPath, 'fetch origin', gitCtx, gitCtx.longTimeout);
      if (!fetchResult.success) {
        return { success: false, error: friendlyGitError(fetchResult.stderr, 'Fetch failed'), details: fetchResult.stderr, logs };
      }
      emit('Fetch completed', 'success');
    }

    if (doPull) {
      const behindCount = await countCommits(repoPath, `${branch}..origin/${branch}`, gitCtx);

      if (behindCount > 0) {
        emit(`Pulling ${behindCount} commits from remote...`, 'info');
        let pullResult = await git(repoPath, ['pull', '--no-edit', '--no-rebase', 'origin', branch], gitCtx, gitCtx.longTimeout);
        if (!pullResult.success) {
          pullResult = await git(repoPath, ['pull', '--allow-unrelated-histories', '--no-edit', '--no-rebase', 'origin', branch], gitCtx, gitCtx.longTimeout);
        }
        if (!pullResult.success) {
          const conflictFiles = await git(repoPath, ['diff', '--name-only', '--diff-filter=U'], gitCtx);
          if (conflictFiles.success && conflictFiles.stdout) {
            await git(repoPath, ['merge', '--abort'], gitCtx);
            const files = conflictFiles.stdout.split('\n').filter(Boolean);
            runtime.onConflict(files);
            return { success: false, error: 'Merge conflict', conflictFiles: files, logs };
          }
          return { success: false, error: friendlyGitError(pullResult.stderr, 'Pull failed'), details: pullResult.stderr, logs };
        }
        emit(`Merged ${behindCount} commits`, 'success');
      }
    }

    if (doPush) {
      const hasChanges = await hasUncommittedChanges(repoPath, gitCtx);
      if (hasChanges) {
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const msg = commitMessage || `auto-sync: ${now}`;
        await git(repoPath, ['add', '-A'], gitCtx);
        const commitResult = await git(repoPath, ['commit', '-m', msg], gitCtx);
        if (commitResult.success) {
          emit(`Committed: ${msg}`, 'success');
        }
      }

      const aheadAfterCount = await countCommits(repoPath, `origin/${branch}..${branch}`, gitCtx);

      if (aheadAfterCount > 0) {
        emit(`Pushing ${aheadAfterCount} commits...`, 'info');
        const pushResult = await git(repoPath, ['push', 'origin', branch], gitCtx, gitCtx.longTimeout);
        if (!pushResult.success) {
          return { success: false, error: friendlyGitError(pushResult.stderr, 'Push failed'), details: pushResult.stderr, logs };
        }
        emit(`Pushed ${aheadAfterCount} commits`, 'success');
      }
    }

    const status = await getRepoStatusInternal(repoPath, payload.remote, gitCtx);
    return { success: true, status, logs };
  } catch (err) {
    return { success: false, error: err.message, logs };
  }
}

module.exports = { executeSyncTask };
