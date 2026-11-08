'use strict';

const { getRepoStatusInternal } = require('../git/repo');

async function executeStatusTask(payload, runtime) {
  const status = await getRepoStatusInternal(payload.repoPath, payload.remote, runtime.gitCtx);
  return { success: true, status };
}

module.exports = { executeStatusTask };
