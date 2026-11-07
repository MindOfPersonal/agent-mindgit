#!/usr/bin/env node
'use strict';

// Genereert update-manifest.json: de lijst met bestanden + sha256 die de agent
// bij een self-update ophaalt en verifieert. Draai dit na elke wijziging en
// commit het resultaat. Verhoog ook het version-veld in package.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const EXPLICIT = ['index.js', 'package.json', 'package-lock.json', 'lib/agent-protocol.js'];
const WALK_DIRS = ['src'];

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const files = [];
  for (const f of EXPLICIT) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) files.push(full);
  }
  for (const d of WALK_DIRS) walk(path.join(ROOT, d), files);

  const map = {};
  for (const full of files.sort()) {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    map[rel] = sha256(full);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    files: map,
  };

  fs.writeFileSync(path.join(ROOT, 'update-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`update-manifest.json geschreven: ${Object.keys(map).length} bestanden (v${pkg.version})\n`);
}

main();
