'use strict';

const fs = require('fs');
const path = require('path');

const AGENT_ROOT = path.join(__dirname, '..');

function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function getLocalVersion() {
  return String(readPackage().version || '0.0.0');
}

function parseVersion(v) {
  return String(v || '0')
    .trim()
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** -1 als a<b, 0 als gelijk, 1 als a>b. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function isNewer(remote, local) {
  return compareVersions(remote, local) > 0;
}

module.exports = {
  AGENT_ROOT,
  readPackage,
  getLocalVersion,
  parseVersion,
  compareVersions,
  isNewer,
};
