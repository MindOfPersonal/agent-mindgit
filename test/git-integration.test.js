'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  makeCtx,
  isGitRepo,
  getBranch,
  hasUncommittedChanges,
  configureIdentity,
  getRepoStatusInternal,
} = require('../src/git/repo');
const { runGit } = require('../src/git/runner');

function gitAvailable() {
  const res = spawnSync('git', ['--version'], { encoding: 'utf-8' });
  return res.status === 0;
}

const maybe = gitAvailable() ? test : test.skip;

maybe('git-integratie: status, branch en identiteit op een echte repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-git-'));
  const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });

  run(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  run(['add', '-A']);
  run(['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);

  const ctx = makeCtx({ timeout: 15000, longTimeout: 20000, maxRetries: 0 });

  assert.equal(isGitRepo(dir), true);

  const branch = await getBranch(dir, ctx);
  assert.equal(typeof branch, 'string');
  assert.ok(branch.length > 0);

  assert.equal(await hasUncommittedChanges(dir, ctx), false);
  fs.writeFileSync(path.join(dir, 'nieuw.txt'), 'x');
  assert.equal(await hasUncommittedChanges(dir, ctx), true);

  await configureIdentity(dir, ctx, 'Bot', 'bot@example.com');
  const email = await runGit(['config', 'user.email'], { cwd: dir });
  assert.equal(email.stdout, 'bot@example.com');

  const status = await getRepoStatusInternal(dir, 'user/repo', ctx);
  assert.equal(status.status, 'changes');
  assert.equal(status.changes, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

maybe('git-integratie: runGit geeft nette foutmelding bij onbekend commando', async () => {
  const res = await runGit(['rev-parse', '--not-a-real-flag'], { cwd: os.tmpdir() });
  assert.equal(res.success, false);
  assert.ok(typeof res.stderr === 'string');
});
