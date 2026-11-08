'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  parseArgs,
  safeJoin,
  setEnvValue,
  readEnvValue,
  mask,
  detectInstall,
  copyTree,
  extractTarGz,
} = require('../setup');

// Bouwt een minimale ustar-header zodat we extractTarGz kunnen testen zonder
// afhankelijk te zijn van het `tar`-commando.
function buildTar(entries) {
  const blocks = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(entry.name, 0, 100, 'utf8');
    header.write(`${(entry.mode || 0o644).toString(8).padStart(7, '0')}\0`, 100, 8, 'utf8');
    header.write('0000000\0', 108, 8, 'utf8');
    header.write('0000000\0', 116, 8, 'utf8');
    header.write(`${entry.data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
    header.write('00000000000\0', 136, 12, 'utf8');
    header.write('        ', 148, 8, 'utf8');
    header.write(entry.type || '0', 156, 1, 'utf8');
    header.write('ustar\0', 257, 6, 'utf8');
    header.write('00', 263, 2, 'utf8');

    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');

    blocks.push(header);
    if (entry.data.length) {
      blocks.push(entry.data);
      const padding = (512 - (entry.data.length % 512)) % 512;
      if (padding) blocks.push(Buffer.alloc(padding, 0));
    }
  }

  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

test('parseArgs vult veilige defaults', () => {
  const opts = parseArgs([]);
  assert.equal(opts.yes, false);
  assert.equal(opts.help, false);
  assert.equal(opts.dir, '');
  assert.equal(opts.start, '');
  assert.equal(opts.dryRun, false);
});

test('parseArgs leest alle relevante flags', () => {
  const opts = parseArgs([
    '--yes',
    '--dir',
    '/tmp/agent',
    '--source',
    'coordinator',
    '--coordinator',
    'https://example.test',
    '--node-key',
    'abc123',
    '--pm2',
    '--dry-run',
    '--force',
  ]);
  assert.equal(opts.yes, true);
  assert.equal(opts.dir, '/tmp/agent');
  assert.equal(opts.source, 'coordinator');
  assert.equal(opts.coordinator, 'https://example.test');
  assert.equal(opts.nodeKey, 'abc123');
  assert.equal(opts.start, 'pm2');
  assert.equal(opts.dryRun, true);
  assert.equal(opts.force, true);
});

test('parseArgs accepteert een positioneel pad', () => {
  assert.equal(parseArgs(['/opt/mindgit']).dir, '/opt/mindgit');
});

test('parseArgs weigert onbekende opties', () => {
  assert.throws(() => parseArgs(['--bestaat-niet']), /Onbekende optie/);
});

test('safeJoin blokkeert path traversal en absolute paden', () => {
  const root = path.join(os.tmpdir(), 'mindgit-safe-root');
  assert.equal(safeJoin(root, 'src/cli.js'), path.join(root, 'src/cli.js'));
  assert.throws(() => safeJoin(root, '../etc/passwd'), /Onveilig pad/);
  assert.throws(() => safeJoin(root, '/etc/passwd'), /Onveilig pad/);
});

test('setEnvValue en readEnvValue werken samen', () => {
  let content = 'A=1\nCOORDINATOR_URL=oud\n';
  content = setEnvValue(content, 'COORDINATOR_URL', 'https://nieuw.test');
  content = setEnvValue(content, 'NODE_KEY', 'geheim');
  assert.equal(readEnvValue(content, 'COORDINATOR_URL'), 'https://nieuw.test');
  assert.equal(readEnvValue(content, 'NODE_KEY'), 'geheim');
  assert.equal(readEnvValue(content, 'A'), '1');
});

test('mask verbergt een node-key', () => {
  assert.equal(mask(''), '');
  assert.equal(mask('kort'), '****');
  assert.equal(mask('abcdefghijkl'), 'abcd…ijkl');
});

test('detectInstall herkent een bestaande agent-installatie', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-detect-'));
  try {
    assert.equal(detectInstall(dir), false);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@mindgit/agent' }));
    assert.equal(detectInstall(dir), false);
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    assert.equal(detectInstall(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractTarGz pakt uit en stript de GitHub-topmap', () => {
  const files = [
    { name: 'agent-master/', type: '5', data: Buffer.alloc(0) },
    { name: 'agent-master/package.json', type: '0', data: Buffer.from('{"name":"@mindgit/agent"}') },
    { name: 'agent-master/src/cli.js', type: '0', data: Buffer.from('module.exports = {};') },
  ];
  const archive = zlib.gzipSync(buildTar(files));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-extract-'));

  try {
    const result = extractTarGz(archive, dest);
    assert.equal(result.files, 2);
    assert.equal(result.strippedTop, 'agent-master');
    assert.equal(
      fs.readFileSync(path.join(dest, 'package.json'), 'utf8'),
      '{"name":"@mindgit/agent"}'
    );
    assert.ok(fs.existsSync(path.join(dest, 'src/cli.js')));
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('extractTarGz weigert een archief met path traversal', () => {
  const archive = zlib.gzipSync(buildTar([
    { name: '../evil.txt', type: '0', data: Buffer.from('kwaad') },
  ]));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-extract-evil-'));

  try {
    assert.throws(() => extractTarGz(archive, dest), /Onveilig pad/);
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('copyTree werkt bij en bewaart .env', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-copy-src-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-copy-dest-'));

  try {
    fs.writeFileSync(path.join(src, 'index.js'), 'nieuw');
    fs.writeFileSync(path.join(src, '.env'), 'SECRET=nieuw');
    fs.writeFileSync(path.join(dest, '.env'), 'SECRET=oud');

    copyTree(src, dest, { preserve: ['.env'] });

    assert.equal(fs.readFileSync(path.join(dest, 'index.js'), 'utf8'), 'nieuw');
    assert.equal(fs.readFileSync(path.join(dest, '.env'), 'utf8'), 'SECRET=oud');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
