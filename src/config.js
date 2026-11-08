'use strict';

const fs = require('fs');
const path = require('path');
const { z } = require('zod');

const AGENT_ROOT = path.join(__dirname, '..');

let dotenvLoaded = false;
function loadDotEnv(envPath) {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const target = envPath || path.join(AGENT_ROOT, '.env');
  try {
    // dotenv v16: standaard worden bestaande env-variabelen NIET overschreven,
    // zodat expliciete omgevingsvariabelen voorrang houden (net als v1).
    require('dotenv').config({ path: target });
  } catch {
    // .env is optioneel; een ontbrekend bestand is geen fout.
  }
}

function bool(defaultValue) {
  return z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultValue;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      const s = String(v).trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(s)) return true;
      if (['0', 'false', 'no', 'off'].includes(s)) return false;
      return defaultValue;
    });
}

function int(defaultValue, { min = 0 } = {}) {
  return z
    .union([z.number(), z.string()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return defaultValue;
      const n = typeof v === 'number' ? v : Number.parseInt(String(v).trim(), 10);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `verwacht een getal, kreeg "${v}"` });
        return z.NEVER;
      }
      if (n < min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `moet >= ${min} zijn, kreeg ${n}` });
        return z.NEVER;
      }
      return n;
    });
}

const schema = z.object({
  coordinatorUrl: z
    .string({ required_error: 'COORDINATOR_URL is verplicht' })
    .trim()
    .min(1, 'COORDINATOR_URL is verplicht')
    .refine((v) => {
      try { new URL(v); return true; } catch { return false; }
    }, 'COORDINATOR_URL moet een geldige URL zijn (bijv. http://server:3000)'),
  nodeKey: z
    .string({ required_error: 'NODE_KEY is verplicht' })
    .trim()
    .min(1, 'NODE_KEY is verplicht'),

  gitTimeout: int(15000, { min: 1000 }),
  gitLongTimeout: int(30000, { min: 1000 }),
  gitMaxRetries: int(2, { min: 0 }),
  gitUserName: z.string().trim().default('MindFramework Auto-Sync'),
  gitUserEmail: z.string().trim().default('mindframework@auto.sync'),

  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).catch('info'),
  logPretty: bool(null),
  logFile: z.string().trim().optional().default(''),

  heartbeatInterval: int(30000, { min: 1000 }),
  taskTimeout: int(300000, { min: 1000 }),
  reconnectBaseDelay: int(5000, { min: 500 }),
  reconnectMaxAttempts: int(0, { min: 0 }),

  browseRoots: z
    .string()
    .optional()
    .default('')
    .transform((v) => String(v).split(',').map((s) => s.trim()).filter(Boolean)),

  updateEnabled: bool(true),
  updateRepo: z.string().trim().default('MindOfPersonal/Mindgit-agent'),
  updateBranch: z.string().trim().default('master'),
  updatePath: z.string().trim().optional().default(''),
  updateInterval: int(3600000, { min: 60000 }),
  updateVerify: bool(true),
});

function normalizeRawEnv(env) {
  return {
    coordinatorUrl: env.COORDINATOR_URL,
    nodeKey: env.NODE_KEY,
    gitTimeout: env.GIT_TIMEOUT,
    gitLongTimeout: env.GIT_LONG_TIMEOUT,
    gitMaxRetries: env.GIT_MAX_RETRIES,
    gitUserName: env.GIT_USER_NAME,
    gitUserEmail: env.GIT_USER_EMAIL,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,
    logFile: env.LOG_FILE,
    heartbeatInterval: env.HEARTBEAT_INTERVAL,
    taskTimeout: env.TASK_TIMEOUT,
    reconnectBaseDelay: env.RECONNECT_BASE_DELAY,
    reconnectMaxAttempts: env.RECONNECT_MAX_ATTEMPTS,
    browseRoots: env.BROWSE_ROOTS,
    updateEnabled: env.UPDATE_ENABLED,
    updateRepo: env.UPDATE_REPO,
    updateBranch: env.UPDATE_BRANCH,
    updatePath: env.UPDATE_PATH,
    updateInterval: env.UPDATE_INTERVAL,
    updateVerify: env.UPDATE_VERIFY,
  };
}

class ConfigError extends Error {
  constructor(issues) {
    super(`Ongeldige configuratie:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Laadt en valideert de configuratie.
 * @param {object} [env] - env-bron (default process.env)
 * @param {{loadEnvFile?: boolean, envPath?: string}} [options]
 * @returns {object} gevalideerde config
 */
function loadConfig(env = process.env, options = {}) {
  if (options.loadEnvFile !== false) loadDotEnv(options.envPath);
  const parsed = schema.safeParse(normalizeRawEnv(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const key = i.path.join('.') || '(root)';
      return `${key}: ${i.message}`;
    });
    throw new ConfigError(issues);
  }
  return Object.freeze(parsed.data);
}

/** Voor de doctor: geeft {ok, config} of {ok:false, issues}. */
function safeLoadConfig(env = process.env, options = {}) {
  try {
    return { ok: true, config: loadConfig(env, options) };
  } catch (err) {
    if (err instanceof ConfigError) return { ok: false, issues: err.issues, error: err };
    return { ok: false, issues: [err.message], error: err };
  }
}

function envFilePath() {
  return path.join(AGENT_ROOT, '.env');
}

function envFileExists() {
  return fs.existsSync(envFilePath());
}

module.exports = {
  AGENT_ROOT,
  ConfigError,
  schema,
  loadConfig,
  safeLoadConfig,
  envFilePath,
  envFileExists,
};
