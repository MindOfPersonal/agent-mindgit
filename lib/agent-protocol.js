'use strict';

// Wire-protocol tussen de MindGit coordinator en de agent.
//
// BELANGRIJK: dit bestand wordt ook door het hoofdproject (MindGit) gebruikt
// (`require('../agent/lib/agent-protocol')` in lib/sync-orchestrator.js en
// lib/node-repo.js). Houd de berichtnamen, waarden en PROTOCOL_VERSION daarom
// exact gelijk. Voeg alleen nieuwe dingen toe; verander nooit bestaande waarden.

const PROTOCOL_VERSION = '1.0';

const MessageType = {
  // Coordinator -> Agent
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

  // Agent -> Coordinator
  HEARTBEAT_ACK: 'heartbeat_ack',
  TASK_STARTED: 'task_started',
  TASK_PROGRESS: 'task_progress',
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  REPO_STATUS: 'repo_status',
  BRANCHES_LIST: 'branches_list',
  CONFLICT_DETECTED: 'conflict_detected',
  AGENT_INFO: 'agent_info',
  ERROR: 'error',
};

const TaskAction = {
  SYNC: 'sync',
  CLONE: 'clone',
  CREATE: 'create',
  FETCH: 'fetch',
  PULL: 'pull',
  PUSH: 'push',
  STATUS: 'status',
  BRANCHES: 'branches',
  SWITCH_BRANCH: 'switch_branch',
  RESOLVE_CONFLICT: 'resolve_conflict',
};

// Berichten die alleen lezen en dus naast een lopende taak mogen draaien.
const READ_ONLY_TYPES = new Set([
  MessageType.GET_STATUS,
  MessageType.GET_BRANCHES,
  MessageType.GET_REPO_DATA,
  MessageType.GET_COMMIT,
  MessageType.GET_DIFF,
  MessageType.BROWSE_DIR,
]);

function createMessage(type, payload, correlationId = null) {
  return {
    v: PROTOCOL_VERSION,
    type,
    payload,
    correlationId,
    timestamp: Date.now(),
  };
}

function parseMessage(data) {
  try {
    const msg = JSON.parse(data);
    if (!msg.v || !msg.type) return null;
    return msg;
  } catch {
    return null;
  }
}

function createSyncRepoPayload(repo, token, options = {}) {
  return {
    repoId: repo.id,
    repoName: repo.name,
    repoPath: repo.path,
    remote: repo.remote,
    token,
    githubUser: repo.github_user,
    commitMessage: options.commitMessage,
    action: options.action || TaskAction.SYNC,
  };
}

function createStatusPayload(repo, token) {
  return {
    repoId: repo.id,
    repoPath: repo.path,
    remote: repo.remote,
    token,
  };
}

function createBranchesPayload(repo, token) {
  return {
    repoId: repo.id,
    repoPath: repo.path,
    token,
  };
}

function createRepoDataPayload(repo, token) {
  return {
    repoId: repo.id,
    repoPath: repo.path,
    token,
  };
}

function createCommitPayload(repo, token, commit) {
  return {
    repoId: repo.id,
    repoPath: repo.path,
    token,
    commit,
  };
}

function createDiffPayload(repo, token, file) {
  return {
    repoId: repo.id,
    repoPath: repo.path,
    token,
    file,
  };
}

function createSwitchBranchPayload(repo, token, branch) {
  return {
    repoId: repo.id,
    repoPath: repo.path,
    token,
    branch,
  };
}

function createResolveConflictPayload(repo, token, strategy) {
  return {
    repoId: repo.id,
    repoPath: repo.path,
    token,
    strategy,
  };
}

function createBrowsePayload(nodePath) {
  return { path: nodePath || '' };
}

function validateAgentMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.v !== PROTOCOL_VERSION) return false;
  if (!MessageType[msg.type.toUpperCase()] && !Object.values(MessageType).includes(msg.type)) return false;
  return true;
}

const HEARTBEAT_INTERVAL = 30000;
const TASK_TIMEOUT = 300000;

module.exports = {
  PROTOCOL_VERSION,
  MessageType,
  TaskAction,
  READ_ONLY_TYPES,
  createMessage,
  parseMessage,
  createSyncRepoPayload,
  createStatusPayload,
  createBranchesPayload,
  createRepoDataPayload,
  createCommitPayload,
  createDiffPayload,
  createSwitchBranchPayload,
  createResolveConflictPayload,
  createBrowsePayload,
  validateAgentMessage,
  HEARTBEAT_INTERVAL,
  TASK_TIMEOUT,
};
