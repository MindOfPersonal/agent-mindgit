'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { Command } = require('commander');

const { AGENT_ROOT, loadConfig, safeLoadConfig, envFilePath, envFileExists } = require('./config');
const { createLogger, isPrettyEnabled, colorEnabled } = require('./logger');
const { Agent, getGitVersion } = require('./agent');
const { getLocalVersion } = require('./version');
const { checkForUpdates, remoteRawUrl } = require('./update/updater');
const { redact } = require('./redact');
const { PROTOCOL_VERSION } = require('../lib/agent-protocol');

const OK = 'OK';
const WARN = 'WAARSCHUWING';
const FAIL = 'FOUT';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function paint(code, s) {
  return colorEnabled() ? `${code}${s}${C.reset}` : s;
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

function line(status, label, detail) {
  const tag = status === OK ? '[ OK ]' : status === WARN ? '[WARN]' : '[FAIL]';
  const tagColor = status === OK ? C.green : status === WARN ? C.yellow : C.red;
  const suffix = detail ? ` ${paint(C.dim, '—')} ${detail}` : '';
  return `${paint(tagColor, tag)} ${paint(C.bold, label)}${suffix}`;
}

function printBanner(config) {
  const rows = [
    paint(C.bold, `MindGit Agent v${getLocalVersion()}`),
    `${paint(C.dim, 'coordinator')}  ${config.coordinatorUrl}`,
    `${paint(C.dim, 'platform')}     ${process.platform}/${process.arch} · node ${process.version}`,
  ];
  const width = Math.max(...rows.map((r) => stripAnsi(r).length));
  const top = `  ${paint(C.cyan, `╭${'─'.repeat(width + 2)}╮`)}`;
  const bottom = `  ${paint(C.cyan, `╰${'─'.repeat(width + 2)}╯`)}`;
  const body = rows
    .map((r) => `  ${paint(C.cyan, '│')} ${r}${' '.repeat(width - stripAnsi(r).length)} ${paint(C.cyan, '│')}`)
    .join('\n');
  process.stdout.write(`\n${top}\n${body}\n${bottom}\n\n`);
}

async function checkCoordinator(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'manual' });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function runDoctor() {
  const results = [];
  let critical = 0;

  results.push(line(OK, 'Agent-versie', `${getLocalVersion()} (protocol ${PROTOCOL_VERSION})`));
  results.push(line(OK, 'Installatiemap', AGENT_ROOT));

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor >= 18) results.push(line(OK, 'Node.js', process.version));
  else { results.push(line(FAIL, 'Node.js', `${process.version} (18+ vereist)`)); critical++; }

  const gitVersion = getGitVersion();
  if (gitVersion !== 'unknown') results.push(line(OK, 'Git', gitVersion));
  else { results.push(line(FAIL, 'Git', 'niet gevonden in PATH')); critical++; }

  const npm = spawnSync('npm', ['--version'], { encoding: 'utf-8', shell: process.platform === 'win32' });
  if (npm.status === 0) results.push(line(OK, 'npm', String(npm.stdout).trim()));
  else results.push(line(WARN, 'npm', 'niet gevonden (nodig voor installatie/updates)'));

  if (envFileExists()) results.push(line(OK, '.env', envFilePath()));
  else results.push(line(WARN, '.env', 'niet gevonden; gebruik omgevingsvariabelen of maak .env aan'));

  try {
    fs.accessSync(AGENT_ROOT, fs.constants.W_OK);
    results.push(line(OK, 'Schrijfrechten', AGENT_ROOT));
  } catch {
    results.push(line(FAIL, 'Schrijfrechten', `geen schrijftoegang tot ${AGENT_ROOT} (nodig voor auto-update)`));
    critical++;
  }

  const loaded = safeLoadConfig(process.env, { loadEnvFile: true });
  let config = null;
  if (loaded.ok) {
    config = loaded.config;
    results.push(line(OK, 'Configuratie', `coordinator ${config.coordinatorUrl}`));
  } else {
    results.push(line(FAIL, 'Configuratie', loaded.issues.join('; ')));
    critical++;
  }

  if (config) {
    const url = config.coordinatorUrl.replace(/\/+$/, '');
    const reach = await checkCoordinator(url);
    if (reach.ok) results.push(line(OK, 'Coordinator bereikbaar', `${url} (HTTP ${reach.status})`));
    else results.push(line(WARN, 'Coordinator bereikbaar', `${url}: ${reach.error}`));

    const wsUrl = config.coordinatorUrl.replace(/^http/, 'ws') + '/agent';
    results.push(line(OK, 'WebSocket-endpoint', wsUrl));

    if (config.updateEnabled) {
      const manifestUrl = remoteRawUrl(config, 'update-manifest.json', config.updateBranch);
      results.push(line(OK, 'Update-bron', `${config.updateRepo}@${config.updateBranch} (${manifestUrl})`));
    }
  }

  const summary =
    critical === 0
      ? paint(C.green, 'Alles ziet er goed uit.')
      : paint(C.red, `${critical} kritiek probleem(en) gevonden.`);
  process.stdout.write(`\n${paint(C.bold, `MindGit Agent v${getLocalVersion()} — doctor`)}\n\n`);
  for (const r of results) process.stdout.write(r + '\n');
  process.stdout.write(`\n${summary}\n`);
  return critical === 0 ? 0 : 1;
}

function runConfig() {
  const loaded = safeLoadConfig(process.env, { loadEnvFile: true });
  if (!loaded.ok) {
    process.stderr.write(`Configuratiefout:\n  - ${loaded.issues.join('\n  - ')}\n`);
    return 1;
  }
  const safe = redact(loaded.config);
  process.stdout.write(JSON.stringify(safe, null, 2) + '\n');
  return 0;
}

async function runUpdate() {
  const loaded = safeLoadConfig(process.env, { loadEnvFile: true });
  if (!loaded.ok) {
    process.stderr.write(`Configuratiefout:\n  - ${loaded.issues.join('\n  - ')}\n`);
    return 1;
  }
  const logger = createLogger(loaded.config);
  const result = await checkForUpdates(loaded.config, logger);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.restart) {
    process.stdout.write('Herstart de agent om de update te activeren.\n');
  }
  return 0;
}

function runStart() {
  let config;
  try {
    config = loadConfig(process.env, { loadEnvFile: true });
  } catch (err) {
    process.stderr.write(`${err.message}\n\n`);
    process.stderr.write('Tip: draai "mindgit-agent doctor" voor een volledige controle.\n');
    return 1;
  }

  const logger = createLogger(config);
  const agent = new Agent(config, logger);

  const stop = (signal) => {
    logger.info(`Signaal ${signal} ontvangen`);
    agent.shutdown(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Onverwachte fout');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Onbehandelde promise-rejection: ${String(reason)}`);
  });

  if (isPrettyEnabled(config)) {
    printBanner(config);
  } else {
    logger.info(
      `MindGit Agent v${getLocalVersion()} gestart → ${config.coordinatorUrl} ` +
        `(${process.platform}/${process.arch}, node ${process.version})`
    );
  }
  logger.debug(`coordinator=${config.coordinatorUrl} platform=${process.platform}/${process.arch} node=${process.version}`);

  agent.start();
  return 0;
}

function buildProgram() {
  const program = new Command();
  program
    .name('mindgit-agent')
    .description('MindGit Distributed Repository Sync Agent')
    .version(getLocalVersion(), '-v, --version', 'toon de agent-versie');

  program
    .command('start', { isDefault: true })
    .description('Start de agent (standaard als geen commando is opgegeven)')
    .action(() => {
      process.exitCode = runStart();
    });

  program
    .command('doctor')
    .description('Controleer Node, Git, configuratie, rechten en coordinator-bereikbaarheid')
    .action(async () => {
      process.exitCode = await runDoctor();
    });

  program
    .command('config')
    .description('Toon de gevalideerde configuratie (geheimen geredigeerd)')
    .action(() => {
      process.exitCode = runConfig();
    });

  program
    .command('update')
    .description('Controleer en pas direct een agent-update toe')
    .action(async () => {
      process.exitCode = await runUpdate();
    });

  return program;
}

async function main(argv = process.argv) {
  const program = buildProgram();
  await program.parseAsync(argv);
}

module.exports = { main, buildProgram, runDoctor, runConfig, runUpdate, runStart };
