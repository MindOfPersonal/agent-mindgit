'use strict';

const fs = require('fs');
const path = require('path');
const { isGitRepo, configureIdentity, getBranch, getRepoStatusInternal, git } = require('../git/repo');
const { friendlyGitError } = require('../git/runner');

/**
 * Maakt lokaal een nieuwe repo aan, koppelt de remote en pusht een eerste commit.
 */
async function executeCreateTask(payload, runtime) {
  const { repoName, repoPath, remote, description } = payload;
  const { gitCtx, config } = runtime;
  const remoteUrl = `https://github.com/${remote}.git`;

  if (fs.existsSync(repoPath) && isGitRepo(repoPath)) {
    return { success: false, error: `Repository already exists at: ${repoPath}` };
  }

  try {
    fs.mkdirSync(repoPath, { recursive: true });
    if (fs.readdirSync(repoPath).length === 0) {
      fs.writeFileSync(path.join(repoPath, 'README.md'), `# ${repoName}\n\n${description || ''}\n`);
    }

    const init = await git(repoPath, ['init'], gitCtx);
    if (!init.success) return { success: false, error: 'git init failed', details: init.stderr };

    await configureIdentity(repoPath, gitCtx, config.gitUserName, config.gitUserEmail);

    const addRemote = await git(repoPath, ['remote', 'add', 'origin', remoteUrl], gitCtx);
    if (!addRemote.success) return { success: false, error: 'Failed to add remote', details: addRemote.stderr };

    const add = await git(repoPath, ['add', '-A'], gitCtx);
    if (!add.success) return { success: false, error: 'git add failed', details: add.stderr };

    const commit = await git(repoPath, ['commit', '-m', 'Initial commit'], gitCtx);
    if (!commit.success) return { success: false, error: 'Initial commit failed', details: commit.stderr };

    const branch = await getBranch(repoPath, gitCtx);
    const push = await git(repoPath, ['push', '-u', 'origin', branch], gitCtx, gitCtx.longTimeout);
    if (!push.success) return { success: false, error: friendlyGitError(push.stderr, 'Push failed'), details: push.stderr };

    const status = await getRepoStatusInternal(repoPath, remote, gitCtx);
    return { success: true, status, branch };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { executeCreateTask };
