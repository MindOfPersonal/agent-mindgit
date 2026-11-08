'use strict';

const fs = require('fs');
const path = require('path');
const { runGit, friendlyGitError } = require('./runner');

const GIT_USER_EMAIL = 'mindframework@auto.sync';
const GIT_USER_NAME = 'MindFramework Auto-Sync';

function isGitRepo(dir) {
  if (!dir || typeof dir !== 'string') return false;
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

function cleanRemoteUrl(remoteRaw) {
  if (!remoteRaw) return '';
  return String(remoteRaw)
    .replace(/https:\/\/[^@]+@github\.com\//, 'github.com/')
    .replace(/\.git$/, '');
}

function parseBranchList(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((b) => b.replace(/^\*?\s*/, '').replace(/^remotes\//, '').trim())
    .filter(Boolean);
}

function makeCtx({ token, timeout, longTimeout, maxRetries, signal }) {
  return { token, timeout, longTimeout, maxRetries, signal };
}

async function git(repoPath, args, ctx, timeout) {
  return runGit(args, {
    cwd: repoPath,
    token: ctx.token,
    timeout: timeout || ctx.timeout,
    maxRetries: ctx.maxRetries,
    signal: ctx.signal,
  });
}

async function getBranch(repoPath, ctx) {
  const res = await git(repoPath, 'rev-parse --abbrev-ref HEAD', ctx);
  return res.success && res.stdout ? res.stdout : 'main';
}

async function hasUncommittedChanges(repoPath, ctx) {
  const res = await git(repoPath, 'status --porcelain', ctx);
  return res.success && res.stdout.length > 0;
}

async function countCommits(repoPath, range, ctx) {
  const res = await git(repoPath, `rev-list --count ${range}`, ctx);
  return res.success ? Number.parseInt(res.stdout || '0', 10) || 0 : 0;
}

async function ensureRepoPresent(payload, emitProgress, ctx) {
  const { repoPath, remote } = payload;
  const remoteUrl = `https://github.com/${remote}.git`;

  if (fs.existsSync(repoPath) && !isGitRepo(repoPath)) {
    return { error: `Path exists but is not a git repository: ${repoPath}` };
  }

  if (!isGitRepo(repoPath)) {
    emitProgress(`Cloning ${remote} into ${repoPath}...`, 'info');
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    const clone = await runGit(['clone', remoteUrl, repoPath], {
      cwd: process.cwd(),
      token: ctx.token,
      timeout: ctx.longTimeout,
      maxRetries: ctx.maxRetries,
      signal: ctx.signal,
    });
    if (!clone.success) {
      return { error: friendlyGitError(clone.stderr, 'Clone failed'), details: clone.stderr };
    }
    emitProgress('Clone completed', 'success');
  }

  const existingRemote = await git(repoPath, 'remote get-url origin', ctx);
  const normalized = (u) => String(u || '').replace(/\.git$/, '');
  if (!existingRemote.success || !existingRemote.stdout) {
    const addRemote = await git(repoPath, ['remote', 'add', 'origin', remoteUrl], ctx);
    if (!addRemote.success) {
      return { error: 'Failed to add remote', details: addRemote.stderr };
    }
  } else if (existingRemote.stdout.includes('@') || normalized(existingRemote.stdout) !== normalized(remoteUrl)) {
    const setRemote = await git(repoPath, ['remote', 'set-url', 'origin', remoteUrl], ctx);
    if (!setRemote.success) {
      return { error: 'Failed to update remote URL', details: setRemote.stderr };
    }
  }

  return null;
}

async function configureIdentity(repoPath, ctx, userName, userEmail) {
  await git(repoPath, ['config', 'user.email', userEmail || GIT_USER_EMAIL], ctx);
  await git(repoPath, ['config', 'user.name', userName || GIT_USER_NAME], ctx);
}

async function getRepoStatusInternal(repoPath, remote, ctx) {
  if (!isGitRepo(repoPath)) {
    return { status: 'no-git', changes: 0, behindCount: 0, aheadCount: 0, branch: '', remote: '' };
  }

  const statusResult = await git(repoPath, 'status --porcelain', ctx);
  const changes = statusResult.success ? statusResult.stdout.split('\n').filter(Boolean).length : 0;

  const branch = await getBranch(repoPath, ctx);
  const cleanRemote = cleanRemoteUrl(remote);

  let behindCount = 0;
  let aheadCount = 0;

  const fetchResult = await git(repoPath, 'fetch origin', ctx, ctx.longTimeout);
  if (fetchResult.success) {
    behindCount = await countCommits(repoPath, `${branch}..origin/${branch}`, ctx);
    aheadCount = await countCommits(repoPath, `origin/${branch}..${branch}`, ctx);
  }

  let statusKey = 'clean';
  if (changes > 0 && behindCount > 0) statusKey = 'both';
  else if (changes > 0) statusKey = 'changes';
  else if (behindCount > 0) statusKey = 'behind';

  return { status: statusKey, changes, behindCount, aheadCount, branch, remote: cleanRemote };
}

module.exports = {
  GIT_USER_EMAIL,
  GIT_USER_NAME,
  isGitRepo,
  cleanRemoteUrl,
  parseBranchList,
  makeCtx,
  git,
  getBranch,
  hasUncommittedChanges,
  countCommits,
  ensureRepoPresent,
  configureIdentity,
  getRepoStatusInternal,
};
