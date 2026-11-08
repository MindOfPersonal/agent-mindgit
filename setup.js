#!/usr/bin/env node
'use strict';

/**
 * MindGit Agent — interactieve installer en beheerder.
 *
 * Dit bestand is zelfstandig: je kunt alleen setup.js op een server zetten en
 * starten met `node setup.js`. Het downloadt de agent (standaard van GitHub of
 * van de MindGit-coordinator), pakt hem uit, vraagt om de configuratie, installeert
 * de dependencies en kan de agent direct via PM2 of systemd starten.
 *
 * Daarna kun je hetzelfde script opnieuw starten voor beheer:
 * bijwerken, starten/stoppen, doctor, logs, .env aanpassen en verwijderen.
 *
 * Gebruik:
 *   node setup.js
 *   node setup.js --yes --dir /opt/mindgit-agent --node-key=... --pm2
 *   node setup.js --install --source coordinator --coordinator https://git.minddev.nl
 *
 * Opties:
 *   -y, --yes            Niet-interactief (gebruik defaults)
 *       --dir <pad>      Installatiemap (default: ~/mindgit-agent)
 *       --install        Ook installeren/bijwerken als er al een installatie is
 *       --menu           Beheer-menu openen
 *       --source <s>     github | coordinator | url
 *       --coordinator <url>  Coordinator-URL (default: https://git.minddev.nl)
 *       --url <url>      Eigen tarball-URL
 *       --repo <owner/repo>  GitHub-repo (default: MindOfPersonal/agent-mindgit)
 *       --branch <naam>  Git-branch (default: master)
 *       --token <token>  GitHub-token voor een private repo (of GITHUB_TOKEN)
 *       --node-key <key> Node-key uit het MindGit-dashboard
 *       --pm2 | --systemd | --foreground | --no-start
 *       --force          Bestaande .env opnieuw configureren
 *       --dry-run        Alleen downloaden/uitpakken, niets installeren
 *       --skip-doctor    Geen doctor uitvoeren
 *       --no-install     Geen npm install uitvoeren
 *   -h, --help           Deze uitleg
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_REPO = 'MindOfPersonal/agent-mindgit';
const DEFAULT_BRANCH = 'master';
const DEFAULT_COORDINATOR = 'https://git.minddev.nl';
const DEFAULT_DIR = path.join(os.homedir(), 'mindgit-agent');
const PM2_NAME = 'MindGitAgent';
const SYSTEMD_UNIT = 'mindgit-agent';
const PKG_NAME = '@mindgit/agent';

// --- Kleuren ---------------------------------------------------------------

function paint(code, value) {
  return process.stdout.isTTY ? `\x1b[${code}m${value}\x1b[0m` : String(value);
}
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const green = (s) => paint('32', s);
const yellow = (s) => paint('33', s);
const red = (s) => paint('31', s);
const cyan = (s) => paint('36', s);

// --- CLI-argumenten --------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    yes: false,
    help: false,
    dir: '',
    source: '',
    coordinator: '',
    url: '',
    token: '',
    repo: '',
    branch: '',
    nodeKey: '',
    force: false,
    dryRun: false,
    install: false,
    menu: false,
    start: '',
    skipDoctor: false,
    noInstall: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Optie ${arg} verwacht een waarde.`);
      return value;
    };

    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--yes':
      case '-y':
        opts.yes = true;
        break;
      case '--dir':
        opts.dir = next();
        break;
      case '--source':
        opts.source = next();
        break;
      case '--coordinator':
        opts.coordinator = next();
        break;
      case '--url':
        opts.url = next();
        break;
      case '--token':
        opts.token = next();
        break;
      case '--repo':
        opts.repo = next();
        break;
      case '--branch':
        opts.branch = next();
        break;
      case '--node-key':
        opts.nodeKey = next();
        break;
      case '--force':
        opts.force = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--install':
        opts.install = true;
        break;
      case '--menu':
        opts.menu = true;
        break;
      case '--skip-doctor':
        opts.skipDoctor = true;
        break;
      case '--no-install':
        opts.noInstall = true;
        break;
      case '--pm2':
        opts.start = 'pm2';
        break;
      case '--systemd':
        opts.start = 'systemd';
        break;
      case '--foreground':
        opts.start = 'foreground';
        break;
      case '--no-start':
        opts.start = 'none';
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Onbekende optie: ${arg}`);
        opts.dir = arg;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
${bold('MindGit Agent — setup & beheer')}

Gebruik:
  node setup.js
  node setup.js --yes --dir /opt/mindgit-agent --node-key=... --pm2
  node setup.js --install --source coordinator

Opties:
  -y, --yes                 Niet-interactief (gebruik defaults)
      --dir <pad>           Installatiemap (default: ${DEFAULT_DIR})
      --install             Ook installeren/bijwerken als er al een installatie is
      --menu                Beheer-menu openen
      --source <bron>       github | coordinator | url
      --coordinator <url>   Coordinator-URL (default: ${DEFAULT_COORDINATOR})
      --url <url>           Eigen tarball-URL
      --repo <owner/repo>   GitHub-repo (default: ${DEFAULT_REPO})
      --branch <naam>       Git-branch (default: ${DEFAULT_BRANCH})
      --token <token>       GitHub-token voor private repo (of GITHUB_TOKEN)
      --node-key <key>      Node-key uit het MindGit-dashboard
      --pm2 | --systemd | --foreground | --no-start
      --force               Bestaande .env opnieuw configureren
      --dry-run             Alleen downloaden/uitpakken, niets installeren
      --skip-doctor         Geen doctor uitvoeren
      --no-install          Geen npm install uitvoeren
  -h, --help                Deze uitleg

Zonder opties start een interactief menu. Het script heeft geen lokale
bestanden nodig: het downloadt de agent zelf.
`);
}

// --- Interactie ------------------------------------------------------------

function ask(question, defaultValue = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const suffix = defaultValue ? dim(` [${defaultValue}]`) : '';
    rl.question(`${question}${suffix} `, (answer) => {
      rl.close();
      const value = String(answer || '').trim();
      resolve(value === '' ? defaultValue : value);
    });
  });
}

async function confirm(question, defaultValue = true) {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} [${hint}]: `, '')).toLowerCase();
  if (!answer) return defaultValue;
  return ['y', 'yes', 'j', 'ja'].includes(answer);
}

// --- Bestands- en env-helpers ---------------------------------------------

function readPackage(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function detectInstall(dir) {
  try {
    const pkg = readPackage(dir);
    return pkg && pkg.name === PKG_NAME && fs.existsSync(path.join(dir, 'index.js'));
  } catch {
    return false;
  }
}

function setEnvValue(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (re.test(content)) return content.replace(re, line);
  return content.replace(/\s*$/, '') + `\n${line}\n`;
}

function readEnvValue(content, key) {
  const match = String(content || '').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

function mask(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function safeJoin(root, relative) {
  const raw = String(relative).replace(/\\/g, '/');
  // Absolute paden (POSIX of Windows) horen nooit in een archief.
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    throw new Error(`Onveilig pad in archief: ${relative}`);
  }
  const clean = raw.replace(/^\.\/+/, '');
  const base = path.resolve(root);
  const target = path.resolve(base, clean);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Onveilig pad in archief: ${relative}`);
  }
  return target;
}

function copyTree(srcDir, destDir, options = {}) {
  const preserve = new Set(options.preserve || []);
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (preserve.has(entry.name)) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyTree(from, to, options);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      try {
        fs.chmodSync(to, fs.statSync(from).mode & 0o777);
      } catch {
        // chmod is niet overal toegestaan; niet fataal.
      }
    }
  }
}

// --- Downloaden ------------------------------------------------------------

function download(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const headers = { 'User-Agent': 'mindgit-agent-setup' };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const req = mod.get(url, { timeout: options.timeout || 60000, headers }, (res) => {
      const status = res.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if ((options.redirects || 0) >= 8) {
          return reject(new Error('Te veel redirects tijdens downloaden.'));
        }
        const next = new URL(res.headers.location, url).toString();
        return resolve(download(next, { ...options, redirects: (options.redirects || 0) + 1 }));
      }

      if (status !== 200) {
        res.resume();
        return reject(new Error(`Download mislukt (HTTP ${status}) voor ${url}`));
      }

      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        chunks.push(chunk);
        bytes += chunk.length;
        if (options.onProgress) options.onProgress(bytes);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), bytes }));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Download time-out.')));
  });
}

async function resolveSource(opts, interactive) {
  let source = opts.source || 'github';

  if (interactive && !opts.source) {
    console.log('\nWaar wil je de agent vandaan halen?');
    console.log('  1) GitHub (aanbevolen)');
    console.log('  2) MindGit-coordinator');
    console.log('  3) Eigen tarball-URL');
    const choice = await ask('Keuze:', '1');
    source = choice === '2' ? 'coordinator' : choice === '3' ? 'url' : 'github';
  }

  if (source === 'coordinator') {
    let base = opts.coordinator || DEFAULT_COORDINATOR;
    if (interactive && !opts.coordinator) base = await ask('Coordinator-URL:', base);
    base = String(base || DEFAULT_COORDINATOR).replace(/\/+$/, '');
    return { url: `${base}/agent/download`, label: `coordinator ${base}`, token: '' };
  }

  if (source === 'url') {
    let url = opts.url || '';
    if (!url && interactive) url = await ask('Tarball-URL:', '');
    if (!url) throw new Error('Geen tarball-URL opgegeven.');
    return { url, label: url, token: '' };
  }

  const repo = opts.repo || DEFAULT_REPO;
  const branch = opts.branch || DEFAULT_BRANCH;
  const token = opts.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const url = token
    ? `https://api.github.com/repos/${repo}/tarball/${branch}`
    : `https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`;
  return { url, label: `${repo}@${branch}`, token };
}

// --- tar.gz uitlezen (zonder externe dependencies) -------------------------

function readTarString(buffer, offset, length) {
  return buffer
    .subarray(offset, offset + length)
    .toString('utf8')
    .replace(/\0[\s\S]*$/, '')
    .trim();
}

function readTarOctal(buffer, offset, length) {
  const raw = readTarString(buffer, offset, length).replace(/[^0-7]/g, '');
  return raw ? Number.parseInt(raw, 8) : 0;
}

function align512(value) {
  return Math.ceil(value / 512) * 512;
}

function parseTar(tar) {
  const entries = [];
  let offset = 0;
  let pendingName = '';

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    let empty = true;
    for (let i = 0; i < header.length; i++) {
      if (header[i] !== 0) {
        empty = false;
        break;
      }
    }
    if (empty) break;

    const name = readTarString(header, 0, 100);
    const mode = readTarOctal(header, 100, 8);
    const size = readTarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = readTarString(header, 345, 155);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const data = tar.subarray(dataStart, Math.min(dataEnd, tar.length));

    if (type === 'L') {
      pendingName = data.toString('utf8').replace(/\0[\s\S]*$/, '');
      offset = align512(dataEnd);
      continue;
    }

    if (type === 'x' || type === 'g') {
      offset = align512(dataEnd);
      continue;
    }

    const fullName = pendingName || (prefix ? `${prefix}/${name}` : name);
    pendingName = '';

    if (type === '0' || type === '\0' || type === '5') {
      entries.push({ name: fullName, mode, size, type, data });
    }

    offset = align512(dataEnd);
  }

  return entries;
}

function extractTarGz(buffer, destDir) {
  let tar;
  try {
    tar = zlib.gunzipSync(buffer);
  } catch (err) {
    throw new Error(`Geen geldig .tar.gz-bestand: ${err.message}`);
  }

  const entries = parseTar(tar);
  if (!entries.length) throw new Error('Archief is leeg of ongeldig.');

  const names = entries
    .map((entry) => entry.name.replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean);
  const tops = [...new Set(names.map((name) => name.split('/')[0]))];
  const top =
    tops.length === 1 && tops[0] !== '.' && tops[0] !== '..' && !tops[0].includes('\\')
      ? tops[0]
      : null;
  const stripTop =
    top && names.every((name) => name === top || name.startsWith(`${top}/`)) && names.some((name) => name !== top)
      ? top
      : null;

  let files = 0;
  for (const entry of entries) {
    let relative = entry.name.replace(/\\/g, '/').replace(/^\.\//, '');
    if (stripTop && (relative === stripTop || relative.startsWith(`${stripTop}/`))) {
      relative = relative.slice(stripTop.length).replace(/^\/+/, '');
    }
    if (!relative || relative === '.') continue;

    const target = safeJoin(destDir, relative);
    if (entry.type === '5') {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
    files++;
    if (entry.mode & 0o111) {
      try {
        fs.chmodSync(target, entry.mode & 0o777);
      } catch {
        // niet fataal
      }
    }
  }

  return { files, strippedTop: stripTop };
}

// --- Commando's ------------------------------------------------------------

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

function pm2HasApp() {
  const result = spawnSync('pm2', ['describe', PM2_NAME], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

async function installDeps(dir) {
  const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
  if (hasLock) {
    console.log(dim('npm ci --omit=dev ...'));
    if (await run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir })) return true;
    console.log(yellow('npm ci mislukt; probeer npm install...'));
  }
  console.log(dim('npm install --omit=dev ...'));
  return run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir });
}

// --- Configuratie ----------------------------------------------------------

async function configureEnv(dir, opts, interactive) {
  const envPath = path.join(dir, '.env');
  const examplePath = path.join(dir, '.env.example');

  let current = '';
  if (fs.existsSync(envPath)) {
    current = fs.readFileSync(envPath, 'utf8');
    if (interactive && !opts.force) {
      const keep = await confirm(`Bestaande .env gevonden (${envPath}). Behhouden?`, true);
      if (keep) {
        return { path: envPath, kept: true, hasNodeKey: Boolean(readEnvValue(current, 'NODE_KEY')) };
      }
    }
  }

  let coordinator = opts.coordinator || readEnvValue(current, 'COORDINATOR_URL') || DEFAULT_COORDINATOR;
  let nodeKey = opts.nodeKey || readEnvValue(current, 'NODE_KEY') || process.env.NODE_KEY || '';
  let updateEnabled = readEnvValue(current, 'UPDATE_ENABLED') || 'false';

  if (interactive) {
    coordinator = await ask('Coordinator-URL:', coordinator);
    nodeKey = await ask('Node-key (leeg laten = later invullen):', nodeKey);
    const upd = await confirm('Auto-update inschakelen (UPDATE_ENABLED=true)?', updateEnabled === 'true');
    updateEnabled = upd ? 'true' : 'false';
  }

  let content = '';
  if (examplePath && fs.existsSync(examplePath)) content = fs.readFileSync(examplePath, 'utf8');
  if (!content) content = '# MindGit Agent configuratie\nCOORDINATOR_URL=\nNODE_KEY=\nUPDATE_ENABLED=false\n';

  content = setEnvValue(content, 'COORDINATOR_URL', coordinator || DEFAULT_COORDINATOR);
  content = setEnvValue(content, 'NODE_KEY', nodeKey || '');
  content = setEnvValue(content, 'UPDATE_ENABLED', updateEnabled);

  fs.writeFileSync(envPath, content, { mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // niet fataal
  }

  return { path: envPath, kept: false, hasNodeKey: Boolean(nodeKey) };
}

// --- Installeren -----------------------------------------------------------

async function installAgent(dir, opts, interactive) {
  const source = await resolveSource(opts, interactive);
  console.log(`\nDownloaden: ${cyan(source.label)}`);

  const { buffer, bytes } = await download(source.url, { token: source.token });
  console.log(`Ontvangen: ${(bytes / 1024 / 1024).toFixed(2)} MB`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgit-setup-'));
  try {
    const { files, strippedTop } = extractTarGz(buffer, tmp);
    const topInfo = strippedTop ? dim(` (topmap "${strippedTop}" genegeerd)`) : '';
    console.log(`Uitgepakt: ${files} bestanden${topInfo}`);

    const pkgPath = path.join(tmp, 'package.json');
    if (!fs.existsSync(pkgPath)) throw new Error('Archief bevat geen package.json; is dit het juiste pakket?');

    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      // ongeldige package.json wordt later door npm/doctor gemeld
    }

    if (pkg.name && pkg.name !== PKG_NAME) {
      console.log(yellow(`Let op: pakketnaam is "${pkg.name}", verwacht "${PKG_NAME}".`));
    }
    console.log(`Versie: ${bold(pkg.version || 'onbekend')}`);

    if (opts.dryRun) {
      console.log(yellow('\nDry-run: er is niets naar de installatiemap geschreven.'));
      return { version: pkg.version || '', installed: false, hasNodeKey: false };
    }

    fs.mkdirSync(dir, { recursive: true });
    copyTree(tmp, dir, { preserve: ['.env'] });
    console.log(green(`Bestanden geplaatst in ${dir}`));

    const env = await configureEnv(dir, opts, interactive);
    console.log(
      env.kept
        ? `Bestaande configuratie behouden: ${env.path}`
        : `Configuratie geschreven: ${env.path}`
    );

    if (!opts.noInstall) {
      console.log('');
      const depsOk = await installDeps(dir);
      if (!depsOk) {
        console.log(red(`Dependencies installeren mislukt. Probeer: cd ${dir} && npm ci --omit=dev`));
      }
    }

    return { version: pkg.version || '', installed: true, hasNodeKey: env.hasNodeKey };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- Starten en services ---------------------------------------------------

function systemdUnit(dir) {
  return `[Unit]
Description=MindGit Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${dir}
ExecStart=${process.execPath} ${path.join(dir, 'index.js')}
EnvironmentFile=${path.join(dir, '.env')}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

async function pm2Start(dir) {
  if (pm2HasApp()) {
    return run('pm2', ['restart', PM2_NAME, '--update-env'], { cwd: dir });
  }
  const ok = await run('pm2', ['start', 'index.js', '--name', PM2_NAME], { cwd: dir });
  if (ok) await run('pm2', ['save']);
  return ok;
}

async function pm2Stop() {
  return run('pm2', ['stop', PM2_NAME]);
}

async function pm2Restart(dir) {
  return pm2HasApp() ? run('pm2', ['restart', PM2_NAME, '--update-env'], { cwd: dir }) : pm2Start(dir);
}

async function startAgent(dir, opts, interactive, hasNodeKey) {
  if (!hasNodeKey) {
    console.log(yellow('\nGeen node-key ingesteld; de agent kan nog niet verbinden.'));
    console.log(`Vul ${path.join(dir, '.env')} in en start daarna opnieuw.`);
    return 'none';
  }

  let mode = opts.start || '';
  if (!mode && interactive) {
    console.log('\nHoe wil je de agent draaien?');
    console.log('  1) PM2 (aanbevolen, automatisch herstarten)');
    console.log('  2) systemd-service (Linux, root)');
    console.log('  3) Handmatig (foreground)');
    console.log('  4) Niet starten');
    const choice = await ask('Keuze:', '1');
    mode = choice === '2' ? 'systemd' : choice === '3' ? 'foreground' : choice === '4' ? 'none' : 'pm2';
  }
  if (!mode) mode = commandExists('pm2') ? 'pm2' : 'none';

  if (mode === 'pm2') {
    if (!commandExists('pm2')) {
      console.log(yellow('PM2 is niet geïnstalleerd.'));
      const install = interactive ? await confirm('PM2 nu globaal installeren met npm?', true) : false;
      if (!install) return 'none';
      if (!(await run('npm', ['install', '-g', 'pm2']))) {
        console.log(red('PM2 installeren mislukt.'));
        return 'none';
      }
    }
    const ok = await pm2Start(dir);
    console.log(ok ? green(`Agent gestart via PM2 als "${PM2_NAME}".`) : red('Starten via PM2 mislukt.'));
    if (ok) console.log(dim('Tip: pm2 save && pm2 startup (eenmalig, zodat hij na een herstart terugkomt).'));
    return ok ? 'pm2' : 'none';
  }

  if (mode === 'systemd') {
    if (process.platform !== 'linux' || !commandExists('systemctl')) {
      console.log(red('systemd is niet beschikbaar op dit systeem.'));
      return 'none';
    }
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      console.log(red('Een systemd-service aanmaken vereist root. Start dit script met sudo.'));
      return 'none';
    }
    const unitPath = `/etc/systemd/system/${SYSTEMD_UNIT}.service`;
    fs.writeFileSync(unitPath, systemdUnit(dir), { mode: 0o644 });
    await run('systemctl', ['daemon-reload']);
    const ok = await run('systemctl', ['enable', '--now', SYSTEMD_UNIT]);
    console.log(ok ? green(`systemd-service "${SYSTEMD_UNIT}" gestart.`) : red('systemd-service starten mislukt.'));
    return ok ? 'systemd' : 'none';
  }

  if (mode === 'foreground') {
    console.log(`Start handmatig met:\n  cd ${dir} && node index.js`);
    return 'foreground';
  }

  return 'none';
}

// --- Beheer ----------------------------------------------------------------

async function runDoctor(dir) {
  console.log(dim('\nnode index.js doctor ...'));
  return run(process.execPath, ['index.js', 'doctor'], { cwd: dir });
}

async function showStatus(dir) {
  const pkg = readPackage(dir);
  console.log(`\nInstallatiemap: ${dir}`);
  console.log(`Versie: ${pkg.version || 'onbekend'}`);

  const envPath = path.join(dir, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    console.log(`Coordinator: ${readEnvValue(content, 'COORDINATOR_URL') || '(niet ingesteld)'}`);
    console.log(`Node-key: ${mask(readEnvValue(content, 'NODE_KEY')) || '(niet ingesteld)'}`);
    console.log(`Auto-update: ${readEnvValue(content, 'UPDATE_ENABLED') || 'false'}`);
  } else {
    console.log(yellow('Geen .env gevonden.'));
  }

  if (pm2HasApp()) {
    const result = spawnSync('pm2', ['describe', PM2_NAME], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    const status = String(result.stdout || '').match(/status\s+│\s+(\w+)/);
    console.log(`PM2: ${status ? status[1] : 'aanwezig'}`);
  } else if (process.platform === 'linux' && commandExists('systemctl')) {
    const result = spawnSync('systemctl', ['is-active', SYSTEMD_UNIT], { encoding: 'utf8' });
    console.log(`systemd: ${String(result.stdout || '').trim() || 'onbekend'}`);
  } else {
    console.log('Service: niet via PM2/systemd gevonden.');
  }
}

async function showLogs() {
  if (pm2HasApp()) {
    return run('pm2', ['logs', PM2_NAME, '--lines', '50', '--nostream']);
  }
  if (process.platform === 'linux' && commandExists('journalctl')) {
    return run('journalctl', ['-u', SYSTEMD_UNIT, '-n', '50', '--no-pager']);
  }
  console.log(yellow('Geen PM2- of systemd-service gevonden.'));
  return false;
}

async function configureInteractive(dir) {
  const env = await configureEnv(dir, { force: true }, true);
  console.log(green(`Configuratie opgeslagen: ${env.path}`));

  if (pm2HasApp()) {
    const restart = await confirm('Agent herstarten om de nieuwe configuratie te laden?', true);
    if (restart) await pm2Restart(dir);
  }
}

async function uninstall(dir) {
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) {
    console.log(red('Weiger om deze map te verwijderen.'));
    return;
  }

  const sure = await confirm(`Weet je zeker dat je de agent in ${resolved} wilt verwijderen?`, false);
  if (!sure) return;

  if (pm2HasApp()) await pm2Stop();

  if (process.platform === 'linux' && commandExists('systemctl')) {
    const unitPath = `/etc/systemd/system/${SYSTEMD_UNIT}.service`;
    if (fs.existsSync(unitPath)) {
      await run('systemctl', ['disable', '--now', SYSTEMD_UNIT]);
      try {
        fs.unlinkSync(unitPath);
      } catch {
        // niet fataal
      }
      await run('systemctl', ['daemon-reload']);
    }
  }

  const keepEnv = await confirm('Het .env-bestand (met node-key) bewaren?', true);
  if (keepEnv) {
    const envPath = path.join(resolved, '.env');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath) : null;
    fs.rmSync(resolved, { recursive: true, force: true });
    if (envContent) {
      fs.mkdirSync(resolved, { recursive: true });
      fs.writeFileSync(envPath, envContent, { mode: 0o600 });
    }
    console.log(green('Agent verwijderd; .env bewaard.'));
  } else {
    fs.rmSync(resolved, { recursive: true, force: true });
    console.log(green('Agent en .env verwijderd.'));
  }
}

async function managementMenu(dir, opts) {
  for (;;) {
    console.log(`\n${bold('MindGit Agent beheer')} — ${dir}`);
    console.log('  1) Bijwerken naar de laatste versie');
    console.log('  2) Starten');
    console.log('  3) Stoppen');
    console.log('  4) Herstarten');
    console.log('  5) Status / doctor');
    console.log('  6) Logs tonen');
    console.log('  7) Configuratie (.env) aanpassen');
    console.log('  8) Verwijderen');
    console.log('  0) Afsluiten');

    const choice = (await ask('Keuze:', '0')).trim();

    if (choice === '0' || choice.toLowerCase() === 'q') return;

    if (choice === '1') {
      const result = await installAgent(dir, { ...opts, force: false, noInstall: false }, true);
      if (result.installed) {
        await runDoctor(dir);
        if (pm2HasApp()) {
          const restart = await confirm('Agent herstarten met de nieuwe versie?', true);
          if (restart) await pm2Restart(dir);
        }
      }
    } else if (choice === '2') {
      const envPath = path.join(dir, '.env');
      const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      await startAgent(dir, { ...opts, start: opts.start || '' }, true, Boolean(readEnvValue(content, 'NODE_KEY')));
    } else if (choice === '3') {
      console.log((await pm2Stop()) ? green('Gestopt.') : yellow('Geen PM2-process gevonden.'));
    } else if (choice === '4') {
      console.log((await pm2Restart(dir)) ? green('Herstart.') : red('Herstarten mislukt.'));
    } else if (choice === '5') {
      await showStatus(dir);
      await runDoctor(dir);
    } else if (choice === '6') {
      await showLogs();
    } else if (choice === '7') {
      await configureInteractive(dir);
    } else if (choice === '8') {
      await uninstall(dir);
      return;
    } else {
      console.log(yellow('Onbekende keuze.'));
    }
  }
}

// --- Hoofdprogramma --------------------------------------------------------

function banner() {
  console.log('');
  console.log(bold(cyan('  MindGit Agent — setup & beheer')));
  console.log(dim('  Installeer, configureer en beheer de agent op deze machine.'));
  console.log('');
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(red(err.message));
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    printHelp();
    return;
  }

  const interactive = !opts.yes && Boolean(process.stdin.isTTY);
  banner();

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
    console.error(red(`Node.js 18 of nieuwer is vereist (gevonden ${process.version}).`));
    process.exitCode = 1;
    return;
  }
  if (!commandExists('npm')) {
    console.log(yellow('npm is niet gevonden; dependencies worden niet geïnstalleerd.'));
    opts.noInstall = true;
  }
  if (!commandExists('git')) {
    console.log(yellow('Git is niet gevonden; de agent heeft Git nodig om repositories te beheren.'));
  }

  const cwd = process.cwd();
  const existing = detectInstall(opts.dir ? path.resolve(opts.dir) : cwd);
  let dir = opts.dir ? path.resolve(opts.dir) : existing ? cwd : DEFAULT_DIR;

  if (existing && !opts.install && !opts.dryRun) {
    if (interactive || opts.menu) {
      await managementMenu(dir, opts);
      return;
    }
    console.log(yellow('Bestaande installatie gevonden. Gebruik --install om bij te werken.'));
    return;
  }

  if (interactive) {
    console.log(`Installatiemap: ${cyan(dir)}`);
    const custom = await ask('Andere map? (leeg = deze map):', '');
    if (custom) dir = path.resolve(custom.replace(/^~(?=$|\/|\\)/, os.homedir()));

    const go = await confirm(`Wil je de MindGit Agent installeren in ${dir}?`, true);
    if (!go) {
      console.log('Geannuleerd.');
      return;
    }
  }

  let result;
  try {
    result = await installAgent(dir, opts, interactive);
  } catch (err) {
    console.error(red(`Installatie mislukt: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  if (opts.dryRun) return;

  if (!opts.skipDoctor && interactive) {
    const check = await confirm('Wil je nu een gezondheidscheck (doctor) uitvoeren?', true);
    if (check) await runDoctor(dir);
  }

  const envPath = path.join(dir, '.env');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const hasNodeKey = Boolean(readEnvValue(envContent, 'NODE_KEY'));

  if (!hasNodeKey) {
    console.log(yellow('\nLet op: er is nog geen node-key ingesteld.'));
    console.log(`Vul ${envPath} in (NODE_KEY=...) voordat je de agent start.`);
  }

  if (opts.start !== 'none') {
    let mode = opts.start;
    if (!mode && interactive) {
      const start = await confirm('Wil je de agent nu starten via PM2?', hasNodeKey);
      mode = start ? 'pm2' : 'none';
    }
    if (mode && mode !== 'none') {
      await startAgent(dir, { ...opts, start: mode }, interactive, hasNodeKey);
    }
  }

  console.log(`\n${green('Klaar.')} Installatie: ${dir}`);
  console.log('Beheer later met:');
  console.log(`  cd ${dir} && node setup.js`);
  console.log('  node index.js doctor');

  if (interactive) {
    const menu = await confirm('Wil je nu het beheer-menu openen?', false);
    if (menu) await managementMenu(dir, opts);
  }

  if (result && result.version) console.log(dim(`\nGeïnstalleerde versie: ${result.version}`));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(red(`Onverwachte fout: ${err && err.stack ? err.stack : err}`));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_DIR,
  DEFAULT_REPO,
  DEFAULT_BRANCH,
  DEFAULT_COORDINATOR,
  parseArgs,
  parseTar,
  extractTarGz,
  safeJoin,
  setEnvValue,
  readEnvValue,
  mask,
  detectInstall,
  copyTree,
  readPackage,
};
