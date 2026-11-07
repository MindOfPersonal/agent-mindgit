'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, safeLoadConfig, ConfigError } = require('../src/config');

const baseEnv = {
  COORDINATOR_URL: 'http://localhost:3000',
  NODE_KEY: 'abc123',
};

test('loadConfig vult verstandige defaults', () => {
  const config = loadConfig({ ...baseEnv }, { loadEnvFile: false });
  assert.equal(config.coordinatorUrl, 'http://localhost:3000');
  assert.equal(config.nodeKey, 'abc123');
  assert.equal(config.gitTimeout, 15000);
  assert.equal(config.gitLongTimeout, 30000);
  assert.equal(config.heartbeatInterval, 30000);
  assert.equal(config.taskTimeout, 300000);
  assert.equal(config.updateRepo, 'MindOfPersonal/Mindgit-agent');
  assert.equal(config.updateBranch, 'master');
  assert.equal(config.updateEnabled, true);
  assert.deepEqual(config.browseRoots, []);
});

test('loadConfig parseert strings, getallen, booleans en lijsten', () => {
  const config = loadConfig(
    {
      ...baseEnv,
      GIT_TIMEOUT: '5000',
      GIT_MAX_RETRIES: '0',
      LOG_LEVEL: 'debug',
      UPDATE_ENABLED: 'false',
      BROWSE_ROOTS: '/srv/repos, /home/user ',
    },
    { loadEnvFile: false }
  );
  assert.equal(config.gitTimeout, 5000);
  assert.equal(config.gitMaxRetries, 0);
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.updateEnabled, false);
  assert.deepEqual(config.browseRoots, ['/srv/repos', '/home/user']);
});

test('loadConfig weigert ontbrekende of ongeldige verplichte waarden', () => {
  assert.throws(() => loadConfig({}, { loadEnvFile: false }), ConfigError);
  assert.throws(
    () => loadConfig({ NODE_KEY: 'x', COORDINATOR_URL: 'geen-url' }, { loadEnvFile: false }),
    ConfigError
  );
});

test('safeLoadConfig geeft issues terug zonder te gooien', () => {
  const result = safeLoadConfig({}, { loadEnvFile: false });
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.issues));
  assert.ok(result.issues.length >= 1);
});
