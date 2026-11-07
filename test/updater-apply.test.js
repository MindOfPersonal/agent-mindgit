'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { applyUpdate, sha256 } = require('../src/update/updater');
const { createSilentLogger } = require('../src/logger');

const config = {
  updateRepo: 'MindOfPersonal/Mindgit-agent',
  updateBranch: 'master',
  updatePath: '',
  updateVerify: true,
};

function makeFetcher(files, manifest) {
  return async (url) => {
    const name = url.split('/').pop();
    if (name === 'update-manifest.json') return JSON.stringify(manifest);
    return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null;
  };
}

test('applyUpdate schrijft geverifieerde bestanden atomisch weg met .bak', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-update-'));
  fs.writeFileSync(path.join(root, 'index.js'), 'oude inhoud');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');

  const files = { 'index.js': 'nieuwe inhoud', 'package.json': '{"version":"2.0.0"}' };
  const manifest = {
    version: '2.0.0',
    files: { 'index.js': sha256(files['index.js']), 'package.json': sha256(files['package.json']) },
  };

  const result = await applyUpdate(config, createSilentLogger(), '2.0.0', 'master', {
    root,
    fetch: makeFetcher(files, manifest),
    runInstall: false,
  });

  assert.equal(result.updated, true);
  assert.equal(result.changed, 2);
  assert.equal(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), 'nieuwe inhoud');
  assert.equal(fs.readFileSync(path.join(root, 'index.js.bak'), 'utf8'), 'oude inhoud');

  fs.rmSync(root, { recursive: true, force: true });
});

test('applyUpdate slaat bestanden met een verkeerde hash over', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-update-'));
  fs.writeFileSync(path.join(root, 'index.js'), 'origineel');

  const files = { 'index.js': 'kwaadaardig' };
  const manifest = { version: '9.9.9', files: { 'index.js': sha256('iets anders') } };

  const result = await applyUpdate(config, createSilentLogger(), '9.9.9', 'master', {
    root,
    fetch: makeFetcher(files, manifest),
    runInstall: false,
  });

  assert.equal(result.updated, false);
  assert.equal(result.changed, 0);
  assert.equal(result.failed, 1);
  assert.equal(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), 'origineel');

  fs.rmSync(root, { recursive: true, force: true });
});

test('applyUpdate doet niets als bestanden al gelijk zijn', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-update-'));
  const content = 'zelfde';
  fs.writeFileSync(path.join(root, 'index.js'), content);

  const manifest = { version: '2.0.0', files: { 'index.js': sha256(content) } };
  const result = await applyUpdate(config, createSilentLogger(), '2.0.0', 'master', {
    root,
    fetch: makeFetcher({ 'index.js': content }, manifest),
    runInstall: false,
  });

  assert.equal(result.updated, false);
  assert.equal(result.changed, 0);
  assert.equal(result.failed, 0);

  fs.rmSync(root, { recursive: true, force: true });
});
