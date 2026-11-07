'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Agent } = require('../src/agent');
const { loadConfig } = require('../src/config');
const { createSilentLogger } = require('../src/logger');

function makeConfig() {
  return loadConfig(
    { COORDINATOR_URL: 'http://127.0.0.1:1', NODE_KEY: 'k', LOG_LEVEL: 'silent' },
    { loadEnvFile: false }
  );
}

test('agent herstart het proces na een toegepaste update', { timeout: 5000 }, async () => {
  const agent = new Agent(makeConfig(), createSilentLogger(), {
    checkForUpdates: async () => ({ updated: true, restart: true, remote: '9.9.9' }),
  });

  const originalStop = agent.stop.bind(agent);
  let stopCalled = false;
  agent.stop = () => {
    stopCalled = true;
    originalStop();
  };

  const originalExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };

  try {
    await agent.runUpdateCheck();
    assert.equal(stopCalled, true, 'agent.stop moet zijn aangeroepen');
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(exitCode, 1, 'agent moet met code 1 afsluiten zodat de supervisor herstart');
  } finally {
    process.exit = originalExit;
  }
});

test('agent blijft draaien als er geen update is', { timeout: 5000 }, async () => {
  const agent = new Agent(makeConfig(), createSilentLogger(), {
    checkForUpdates: async () => ({ updated: false, restart: false }),
  });

  let stopCalled = false;
  const originalStop = agent.stop.bind(agent);
  agent.stop = () => {
    stopCalled = true;
    originalStop();
  };

  await agent.runUpdateCheck();
  assert.equal(stopCalled, false);
  assert.equal(agent.updateRunning, false);
});
