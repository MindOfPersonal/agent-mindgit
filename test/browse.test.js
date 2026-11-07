'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { isWithinAgentRoots, agentBrowseRoots } = require('../src/tasks/browse');

test('isWithinAgentRoots staat paden binnen de root toe', () => {
  const root = path.resolve('/srv/repos');
  assert.equal(isWithinAgentRoots(path.join(root, 'a', 'b'), [root]), true);
  assert.equal(isWithinAgentRoots(root, [root]), true);
});

test('isWithinAgentRoots blokkeert traversal en buitenliggende paden', () => {
  const root = path.resolve('/srv/repos');
  assert.equal(isWithinAgentRoots(path.resolve('/srv/repos/../geheim'), [root]), false);
  assert.equal(isWithinAgentRoots(path.resolve('/etc/passwd'), [root]), false);
  assert.equal(isWithinAgentRoots('/srv/reposother', [root]), false);
});

test('agentBrowseRoots valt terug op home als er niets is geconfigureerd', () => {
  const roots = agentBrowseRoots({ browseRoots: [] });
  assert.equal(Array.isArray(roots), true);
  assert.ok(roots.length >= 1);
});
