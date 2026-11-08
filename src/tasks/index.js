'use strict';

const { MessageType } = require('../../lib/agent-protocol');

const { executeSyncTask } = require('./sync');
const { executeCreateTask } = require('./create');
const { executeStatusTask } = require('./status');
const { executeBranchesTask } = require('./branches');
const { executeRepoDataTask } = require('./repo-data');
const { executeCommitTask } = require('./commit');
const { executeDiffTask } = require('./diff');
const { executeSwitchBranchTask } = require('./switch-branch');
const { executeResolveConflictTask } = require('./resolve-conflict');
const { executeBrowseTask } = require('./browse');

const TASK_HANDLERS = {
  [MessageType.SYNC_REPO]: executeSyncTask,
  [MessageType.CLONE_REPO]: executeSyncTask,
  [MessageType.FETCH_REPO]: executeSyncTask,
  [MessageType.PULL_REPO]: executeSyncTask,
  [MessageType.PUSH_REPO]: executeSyncTask,
  [MessageType.CREATE_REPO]: executeCreateTask,
  [MessageType.GET_STATUS]: executeStatusTask,
  [MessageType.GET_BRANCHES]: executeBranchesTask,
  [MessageType.GET_REPO_DATA]: executeRepoDataTask,
  [MessageType.GET_COMMIT]: executeCommitTask,
  [MessageType.GET_DIFF]: executeDiffTask,
  [MessageType.SWITCH_BRANCH]: executeSwitchBranchTask,
  [MessageType.RESOLVE_CONFLICT]: executeResolveConflictTask,
  [MessageType.BROWSE_DIR]: executeBrowseTask,
};

function getTaskHandler(type) {
  return TASK_HANDLERS[type] || null;
}

module.exports = { TASK_HANDLERS, getTaskHandler };
