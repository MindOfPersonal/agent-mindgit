'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const proto = require('../lib/agent-protocol');

test('protocolversie blijft 1.0 voor compatibiliteit met de coordinator', () => {
  assert.equal(proto.PROTOCOL_VERSION, '1.0');
});

test('verplichte berichtnamen en waarden zijn ongewijzigd', () => {
  const expected = {
    HEARTBEAT: 'heartbeat',
    SYNC_REPO: 'sync_repo',
    CLONE_REPO: 'clone_repo',
    CREATE_REPO: 'create_repo',
    FETCH_REPO: 'fetch_repo',
    PULL_REPO: 'pull_repo',
    PUSH_REPO: 'push_repo',
    GET_STATUS: 'get_status',
    GET_BRANCHES: 'get_branches',
    GET_REPO_DATA: 'get_repo_data',
    GET_COMMIT: 'get_commit',
    GET_DIFF: 'get_diff',
    SWITCH_BRANCH: 'switch_branch',
    RESOLVE_CONFLICT: 'resolve_conflict',
    BROWSE_DIR: 'browse_dir',
    CANCEL_TASK: 'cancel_task',
    SHUTDOWN: 'shutdown',
    HEARTBEAT_ACK: 'heartbeat_ack',
    TASK_STARTED: 'task_started',
    TASK_PROGRESS: 'task_progress',
    TASK_COMPLETED: 'task_completed',
    TASK_FAILED: 'task_failed',
    CONFLICT_DETECTED: 'conflict_detected',
    AGENT_INFO: 'agent_info',
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(proto.MessageType[key], value, `${key} moet "${value}" zijn`);
  }
});

test('createMessage/parseMessage roundtrip', () => {
  const msg = proto.createMessage(proto.MessageType.HEARTBEAT, { x: 1 }, 'c1');
  assert.equal(msg.v, '1.0');
  assert.equal(msg.type, 'heartbeat');
  assert.equal(msg.correlationId, 'c1');

  const parsed = proto.parseMessage(JSON.stringify(msg));
  assert.deepEqual(parsed, msg);
});

test('parseMessage negeert ongeldige input', () => {
  assert.equal(proto.parseMessage('geen json'), null);
  assert.equal(proto.parseMessage(JSON.stringify({ type: 'heartbeat' })), null);
});

test('validateAgentMessage accepteert bekende types en wijst onbekende af', () => {
  assert.equal(proto.validateAgentMessage(proto.createMessage(proto.MessageType.GET_STATUS, {})), true);
  assert.equal(proto.validateAgentMessage({ v: '2.0', type: 'heartbeat' }), false);
  assert.equal(proto.validateAgentMessage({ v: '1.0', type: 'bestaat_niet' }), false);
});

test('payload-helpers behouden de bestaande vorm', () => {
  const repo = { id: 7, name: 'demo', path: '/tmp/demo', remote: 'user/demo', github_user: 'user' };
  assert.deepEqual(proto.createStatusPayload(repo, 'tok'), {
    repoId: 7,
    repoPath: '/tmp/demo',
    remote: 'user/demo',
    token: 'tok',
  });
  assert.deepEqual(proto.createCommitPayload(repo, 'tok', 'abc'), {
    repoId: 7,
    repoPath: '/tmp/demo',
    token: 'tok',
    commit: 'abc',
  });
  assert.deepEqual(proto.createBrowsePayload('/home/x'), { path: '/home/x' });
  assert.deepEqual(proto.createBrowsePayload(), { path: '' });
});

test('READ_ONLY_TYPES bevat de query-berichten', () => {
  for (const t of ['get_status', 'get_branches', 'get_repo_data', 'get_commit', 'get_diff', 'browse_dir']) {
    assert.equal(proto.READ_ONLY_TYPES.has(t), true, `${t} hoort read-only te zijn`);
  }
  assert.equal(proto.READ_ONLY_TYPES.has('sync_repo'), false);
});
