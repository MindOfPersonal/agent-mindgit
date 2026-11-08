'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { AGENT_ROOT, getLocalVersion, isNewer, compareVersions } = require('../version');

// Bestanden die meegaan in een update als er geen manifest beschikbaar is.
const FALLBACK_FILES = [
  'index.js',
  'package.json',
  'package-lock.json',
  'lib/agent-protocol.js',
  'src/agent.js',
  'src/cli.js',
  'src/config.js',
  'src/logger.js',
  'src/redact.js',
  'src/version.js',
  'src/git/repo.js',
  'src/git/runner.js',
  'src/tasks/index.js',
  'src/tasks/sync.js',
  'src/tasks/create.js',
  'src/tasks/status.js',
  'src/tasks/branches.js',
  'src/tasks/repo-data.js',
  'src/tasks/commit.js',
  'src/tasks/diff.js',
  'src/tasks/switch-branch.js',
  'src/tasks/resolve-conflict.js',
  'src/tasks/browse.js',
  'src/update/updater.js',
];

function branchCandidates(config) {
  return [config.updateBranch, 'master', 'main'].filter((b, i, a) => b && a.indexOf(b) === i);
}

function remoteRawUrl(config, file, branch) {
  const prefix = config.updatePath ? config.updatePath.replace(/^\/+|\/+$/g, '') + '/' : '';
  return `https://raw.githubusercontent.com/${config.updateRepo}/${branch || config.updateBranch}/${prefix}${file}`;
}

function fetchRaw(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https:') ? https : http;
    let req;
    try {
      req = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'mindgit-agent' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      });
    } catch {
      return resolve(null);
    }
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashFile(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

function runNpmInstall(logger) {
  return new Promise((resolve) => {
    logger.info('package.json is gewijzigd; npm install uitvoeren...');
    let proc;
    try {
      proc = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: AGENT_ROOT,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'npm install kon niet worden gestart');
      return resolve(false);
    }
    const timer = setTimeout(() => {
      logger.warn('npm install duurde te lang; doorgegaan zonder');
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }, 120000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function loadManifest(config, branch, fetchFn = fetchRaw) {
  const raw = await fetchFn(remoteRawUrl(config, 'update-manifest.json', branch));
  if (!raw) return null;
  try {
    const manifest = JSON.parse(raw);
    if (!manifest || typeof manifest !== 'object' || typeof manifest.files !== 'object') return null;
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Werkt bestanden atomisch bij. Downloadt en verifieert eerst alles, schrijft
 * daarna pas weg (met .bak-backup en rollback bij een fout).
 * @param {object} config
 * @param {object} logger
 * @param {string} remoteVersion
 * @param {string} branch
 * @param {{root?:string, fetch?:Function, runInstall?:boolean}} [options] - injecteerbaar voor tests
 */
async function applyUpdate(config, logger, remoteVersion, branch, options = {}) {
  const root = options.root || AGENT_ROOT;
  const fetchFn = options.fetch || fetchRaw;
  const manifest = await loadManifest(config, branch, fetchFn);
  const files = manifest && manifest.files ? Object.keys(manifest.files) : FALLBACK_FILES;
  if (!manifest) {
    logger.warn('Geen update-manifest gevonden; update zonder hash-verificatie');
  }

  const staged = [];
  let failed = 0;

  for (const file of files) {
    const content = await fetchFn(remoteRawUrl(config, file, branch));
    if (content === null) {
      logger.warn({ file }, 'Update: bestand niet te downloaden (overgeslagen)');
      failed++;
      continue;
    }

    const expected = manifest && manifest.files ? manifest.files[file] : null;
    if (config.updateVerify && expected && sha256(content) !== expected) {
      logger.warn({ file }, 'Update: hash komt niet overeen (overgeslagen)');
      failed++;
      continue;
    }

    const dest = path.join(root, file);
    const currentHash = hashFile(dest);
    if (currentHash === sha256(content)) continue; // ongewijzigd

    staged.push({ file, dest, content });
  }

  if (staged.length === 0) {
    logger.info('Update: geen bestanden gewijzigd');
    return { updated: false, changed: 0, failed };
  }

  const written = [];
  try {
    for (const item of staged) {
      fs.mkdirSync(path.dirname(item.dest), { recursive: true });
      if (fs.existsSync(item.dest)) {
        fs.copyFileSync(item.dest, item.dest + '.bak');
      }
      const tmp = item.dest + '.update.tmp';
      fs.writeFileSync(tmp, item.content);
      fs.renameSync(tmp, item.dest);
      written.push(item);
      logger.info({ file: item.file }, 'Update: bestand bijgewerkt');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Update mislukt; wijzigingen terugdraaien');
    for (const item of written) {
      try {
        if (fs.existsSync(item.dest + '.bak')) fs.copyFileSync(item.dest + '.bak', item.dest);
      } catch {
        // beste poging
      }
    }
    return { updated: false, changed: 0, failed: failed + 1, error: err.message };
  }

  const pkgChanged = written.some((w) => w.file === 'package.json' || w.file === 'package-lock.json');
  if (pkgChanged && options.runInstall !== false) await runNpmInstall(logger);

  logger.info({ version: remoteVersion, changed: written.length, failed }, 'Update toegepast; agent herstart');
  return { updated: true, changed: written.length, failed, restart: true };
}

/**
 * Vergelijkt de lokale versie met de remote en werkt indien nodig bij.
 * @returns {Promise<{checked:boolean, updated:boolean, local:string, remote?:string, branch?:string}>}
 */
async function checkForUpdates(config, logger, options = {}) {
  if (!config.updateEnabled) return { checked: false, updated: false, local: getLocalVersion() };

  const fetchFn = options.fetch || fetchRaw;
  const local = getLocalVersion();
  let branch = null;
  let remoteVersion = '';

  for (const b of branchCandidates(config)) {
    const pkgRaw = await fetchFn(remoteRawUrl(config, 'package.json', b));
    if (pkgRaw === null) continue;
    branch = b;
    try {
      remoteVersion = JSON.parse(pkgRaw).version || '';
    } catch {
      remoteVersion = '';
    }
    break;
  }

  if (!branch) {
    logger.warn({ repo: config.updateRepo }, 'Update-check: remote package.json niet bereikbaar');
    return { checked: true, updated: false, local };
  }

  logger.debug({ local, remote: remoteVersion || 'onbekend', repo: config.updateRepo, branch }, 'Update-check');

  if (!remoteVersion || compareVersions(remoteVersion, local) <= 0) {
    return { checked: true, updated: false, local, remote: remoteVersion, branch };
  }

  logger.info({ local, remote: remoteVersion, branch }, 'Nieuwe versie beschikbaar');
  const result = await applyUpdate(config, logger, remoteVersion, branch, options);
  return { checked: true, ...result, local, remote: remoteVersion, branch };
}

module.exports = {
  FALLBACK_FILES,
  branchCandidates,
  remoteRawUrl,
  fetchRaw,
  sha256,
  hashFile,
  loadManifest,
  applyUpdate,
  checkForUpdates,
  isNewer,
};
