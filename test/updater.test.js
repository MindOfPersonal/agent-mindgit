'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { branchCandidates, remoteRawUrl, sha256, FALLBACK_FILES } = require('../src/update/updater');

test('branchCandidates bevat unieke kandidaten', () => {
  const branches = branchCandidates({ updateBranch: 'master' });
  assert.deepEqual(branches, ['master', 'main']);
  assert.deepEqual(branchCandidates({ updateBranch: 'main' }), ['main', 'master']);
});

test('remoteRawUrl respecteert UPDATE_PATH', () => {
  const config = { updateRepo: 'MindOfPersonal/Mindgit-agent', updateBranch: 'master', updatePath: '' };
  assert.equal(
    remoteRawUrl(config, 'index.js', 'master'),
    'https://raw.githubusercontent.com/MindOfPersonal/Mindgit-agent/master/index.js'
  );
  const withPath = { ...config, updatePath: 'agent/' };
  assert.equal(
    remoteRawUrl(withPath, 'index.js', 'master'),
    'https://raw.githubusercontent.com/MindOfPersonal/Mindgit-agent/master/agent/index.js'
  );
});

test('sha256 is stabiel', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
});

test('FALLBACK_FILES bevat de kernbestanden', () => {
  for (const f of ['index.js', 'lib/agent-protocol.js', 'src/agent.js', 'src/cli.js']) {
    assert.ok(FALLBACK_FILES.includes(f), `${f} ontbreekt in FALLBACK_FILES`);
  }
});
