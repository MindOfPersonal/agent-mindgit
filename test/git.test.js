'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBranchList, cleanRemoteUrl, isGitRepo } = require('../src/git/repo');
const { tokenize, isTransientError, friendlyGitError } = require('../src/git/runner');

test('parseBranchList schoont git branch -a output op', () => {
  const raw = '* main\n  feature/x\n  remotes/origin/main\n  remotes/origin/feature/x\n';
  assert.deepEqual(parseBranchList(raw), ['main', 'feature/x', 'origin/main', 'origin/feature/x']);
});

test('cleanRemoteUrl verwijdert token en .git', () => {
  assert.equal(cleanRemoteUrl('https://x-access-token:ghp_secret@github.com/user/repo.git'), 'github.com/user/repo');
  assert.equal(cleanRemoteUrl('https://github.com/user/repo.git'), 'https://github.com/user/repo');
});

test('isGitRepo is veilig voor ongeldige input', () => {
  assert.equal(isGitRepo(undefined), false);
  assert.equal(isGitRepo(''), false);
});

test('tokenize respecteert quotes', () => {
  assert.deepEqual(tokenize('commit -m "hello world"'), ['commit', '-m', 'hello world']);
  assert.deepEqual(tokenize("log --format='%H %s'"), ['log', '--format=%H %s']);
});

test('isTransientError herkent netwerkfouten maar niet auth-fouten', () => {
  assert.equal(isTransientError('fatal: unable to access ... Could not resolve host'), true);
  assert.equal(isTransientError('error: failed to push some refs'), false);
});

test('friendlyGitError vertaalt bekende fouten', () => {
  assert.match(friendlyGitError('remote: Repository not found.'), /niet gevonden/i);
  assert.match(friendlyGitError('fatal: Authentication failed for https://github.com/x/y'), /authenticatie/i);
  assert.match(friendlyGitError('fatal: unable to access: Could not resolve host: github.com'), /DNS/i);
});

test('friendlyGitError pakt de fatal-regel als er geen patroon matcht', () => {
  const out = friendlyGitError('hint: iets\nfatal: branch niet gevonden\nmeer tekst');
  assert.equal(out, 'branch niet gevonden');
});
