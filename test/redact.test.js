'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerSecret, redactString, redact } = require('../src/redact');

test('bekende geheimen worden vervangen', () => {
  registerSecret('supergeheim123');
  assert.equal(redactString('token is supergeheim123 einde'), 'token is [REDACTED] einde');
});

test('GitHub-tokenpatronen worden vervangen', () => {
  const out = redactString('Authorization: ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  assert.ok(!out.includes('ghp_'));
  assert.ok(out.includes('[REDACTED]'));
});

test('redact vervangt geheime sleutels in objecten', () => {
  const out = redact({ token: 'abc', nested: { nodeKey: 'def', keep: 'ok' } });
  assert.equal(out.token, '[REDACTED]');
  assert.equal(out.nested.nodeKey, '[REDACTED]');
  assert.equal(out.nested.keep, 'ok');
});

test('redact gaat om met arrays, errors en cycles', () => {
  const cyclic = { name: 'x' };
  cyclic.self = cyclic;
  const out = redact({ list: ['ghp_abcdefghijklmnopqrstuvwxyz0123456789'], err: new Error('mislukt: supergeheim123'), cyclic });
  assert.ok(!out.list[0].includes('ghp_'));
  assert.equal(out.list[0], '[REDACTED]');
  assert.equal(out.err.message, 'mislukt: [REDACTED]');
  assert.equal(out.cyclic.self, '[Circular]');
});
