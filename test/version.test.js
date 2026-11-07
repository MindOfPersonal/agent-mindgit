'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { compareVersions, parseVersion, isNewer } = require('../src/version');

test('parseVersion splitst versies', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('2.0.0-beta.1'), [2, 0, 0, 0, 1]);
});

test('compareVersions vergelijkt numeriek', () => {
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
});

test('isNewer werkt met ontbrekende delen', () => {
  assert.equal(isNewer('2.0', '1.9.9'), true);
  assert.equal(isNewer('1.0', '1.0.0'), false);
  assert.equal(isNewer('0.0.1', '0.0.2'), false);
});
