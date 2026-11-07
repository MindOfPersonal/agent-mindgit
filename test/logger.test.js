'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatLine, createPrettyStream, isPrettyEnabled, colorEnabled } = require('../src/logger');

const ISO = new Date(2026, 0, 2, 3, 4, 5).toISOString();

test('formatLine maakt een uitgelijnde, enkele regel', () => {
  assert.equal(formatLine({ time: ISO, level: 'info', msg: 'Hallo' }, { color: false }), '03:04:05 INFO  Hallo');
});

test('formatLine lijnt levels uit en toont extra velden', () => {
  const line = formatLine({ time: ISO, level: 'warn', msg: 'Let op', repoId: 59 }, { color: false });
  assert.equal(line, '03:04:05 WARN  Let op  repoId=59');
});

test('formatLine kleurt alleen als color=true', () => {
  const plain = formatLine({ time: ISO, level: 'error', msg: 'Fout' }, { color: false });
  const colored = formatLine({ time: ISO, level: 'error', msg: 'Fout' }, { color: true });
  assert.equal(plain.includes('\x1b['), false);
  assert.equal(colored.includes('\x1b['), true);
});

test('formatLine toont error en stack', () => {
  const err = new Error('kapot');
  err.stack = 'Error: kapot\n    at bestand.js:1:1';
  const line = formatLine({ time: ISO, level: 'error', msg: 'Crash', err }, { color: false });
  assert.ok(line.includes('✖ kapot'));
  assert.ok(line.includes('at bestand.js:1:1'));
});

test('createPrettyStream zet JSON-regels om naar leesbare tekst', async () => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (s) => {
    chunks.push(String(s));
    return true;
  };
  try {
    const stream = createPrettyStream({ color: false });
    stream.write(JSON.stringify({ time: ISO, level: 'info', msg: 'Hallo' }) + '\n');
    await new Promise((resolve) => stream.end(resolve));
  } finally {
    process.stdout.write = original;
  }
  assert.equal(chunks.join(''), '03:04:05 INFO  Hallo\n');
});

test('isPrettyEnabled respecteert de config', () => {
  assert.equal(isPrettyEnabled({ logPretty: true }), true);
  assert.equal(isPrettyEnabled({ logPretty: false }), false);
});

test('colorEnabled respecteert NO_COLOR en FORCE_COLOR', () => {
  const original = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
  try {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    assert.equal(colorEnabled(), true);
    process.env.NO_COLOR = '1';
    assert.equal(colorEnabled(), false);
  } finally {
    if (original.NO_COLOR === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = original.NO_COLOR;
    if (original.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = original.FORCE_COLOR;
  }
});
