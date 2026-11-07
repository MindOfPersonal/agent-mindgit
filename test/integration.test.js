'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const { loadConfig } = require('../src/config');
const { createSilentLogger } = require('../src/logger');
const { Agent } = require('../src/agent');
const { MessageType, createMessage, parseMessage } = require('../lib/agent-protocol');

test('agent registreert zich en verwerkt browse_dir end-to-end', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-agent-it-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  fs.mkdirSync(path.join(dir, 'sub'));

  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.once('listening', resolve));
  const port = wss.address().port;

  let agentInfo = null;
  let authHeader = null;
  let resolveTask;
  const taskDone = new Promise((resolve) => { resolveTask = resolve; });

  wss.on('connection', (ws, req) => {
    authHeader = req.headers['x-node-key'];
    ws.on('message', (data) => {
      const msg = parseMessage(data);
      if (!msg) return;
      if (msg.type === MessageType.AGENT_INFO) {
        agentInfo = msg.payload;
        ws.send(JSON.stringify(createMessage(MessageType.AGENT_INFO, { nodeId: 1, name: 'test-node' })));
        ws.send(
          JSON.stringify(
            createMessage(MessageType.BROWSE_DIR, { path: dir, base: dir }, 'q1')
          )
        );
      }
      if (msg.type === MessageType.TASK_COMPLETED && msg.correlationId === 'q1') {
        resolveTask(msg.payload);
      }
      if (msg.type === MessageType.TASK_FAILED && msg.correlationId === 'q1') {
        resolveTask(msg.payload);
      }
    });
  });

  const config = loadConfig(
    {
      COORDINATOR_URL: `http://127.0.0.1:${port}`,
      NODE_KEY: 'testkey',
      UPDATE_ENABLED: 'false',
      LOG_LEVEL: 'silent',
      HEARTBEAT_INTERVAL: '60000',
    },
    { loadEnvFile: false }
  );

  const agent = new Agent(config, createSilentLogger());
  agent.start();

  const payload = await taskDone;

  assert.equal(authHeader, 'testkey');
  assert.ok(agentInfo, 'agent_info moet ontvangen zijn');
  assert.equal(agentInfo.platform, os.platform());
  assert.equal(agentInfo.capabilities.protocolVersion, '1.0');
  assert.ok(Array.isArray(agentInfo.capabilities.features));

  assert.equal(payload.success, true);
  assert.equal(payload.path, dir);
  const names = payload.entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['a.txt', 'sub']);

  agent.stop();
  await new Promise((resolve) => wss.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});
