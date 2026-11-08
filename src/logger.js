'use strict';

const { Writable } = require('stream');
const pino = require('pino');
const { redact } = require('./redact');

const REDACT_PATHS = [
  'token',
  '*.token',
  'payload.token',
  'authorization',
  '*.authorization',
  'nodeKey',
  '*.nodeKey',
  'node_key',
  '*.node_key',
];

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const LEVEL_COLOR = {
  trace: '\x1b[90m',
  debug: '\x1b[90m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[35m',
};

const IGNORED_FIELDS = new Set(['time', 'level', 'msg', 'pid', 'hostname', 'name', 'v']);

function colorEnabled() {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

/** Pretty als de config het expliciet zegt, anders automatisch op een TTY. */
function isPrettyEnabled(config) {
  if (!config) return false;
  if (config.logPretty === true) return true;
  if (config.logPretty === false) return false;
  return Boolean(process.stdout.isTTY);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }
  return String(value);
}

/**
 * Formatteert één logobject naar een leesbare regel (of meerdere bij een error).
 * Geëxporteerd zodat het getest kan worden.
 */
function formatLine(obj, options = {}) {
  const color = options.color === true;
  const c = (code, s) => (color ? `${code}${s}${RESET}` : s);

  const time = formatTime(obj.time);
  const level = String(obj.level || 'info').toLowerCase();
  const levelLabel = c(LEVEL_COLOR[level] || '', level.toUpperCase().padEnd(5));
  const msg = obj.msg === undefined || obj.msg === null ? '' : String(obj.msg);

  let out = `${c(DIM, time)} ${levelLabel} ${msg}`;

  const extras = [];
  for (const [key, value] of Object.entries(obj)) {
    if (IGNORED_FIELDS.has(key) || key === 'err' || value === undefined) continue;
    extras.push(`${c(DIM, key)}=${formatValue(value)}`);
  }
  if (extras.length) out += '  ' + extras.join(' ');

  if (obj.err) {
    const err = obj.err;
    const message = typeof err === 'string' ? err : err.message || formatValue(err);
    out += '\n' + c(LEVEL_COLOR.error, `  ✖ ${message}`);
    if (err && typeof err === 'object' && err.stack && options.stack !== false) {
      const stack = String(err.stack)
        .split('\n')
        .slice(1)
        .map((l) => `    ${l.trim()}`)
        .join('\n');
      if (stack) out += '\n' + c(DIM, stack);
    }
  }

  return out;
}

/** Writable stream die JSON-logregels van pino omzet naar leesbare tekst. */
function createPrettyStream(options = {}) {
  let buffer = '';
  const render = (line) => {
    if (!line.trim()) return;
    try {
      process.stdout.write(formatLine(JSON.parse(line), options) + '\n');
    } catch {
      process.stdout.write(line + '\n');
    }
  };

  return new Writable({
    write(chunk, _enc, cb) {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        render(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
      cb();
    },
    final(cb) {
      render(buffer);
      buffer = '';
      cb();
    },
  });
}

function wrap(base) {
  const logger = {};
  for (const level of LEVELS) {
    logger[level] = (arg1, arg2, ...rest) => {
      if (typeof arg1 === 'string') {
        if (arg2 === undefined) base[level](arg1);
        else base[level](redact(arg2), arg1, ...rest);
      } else {
        base[level](redact(arg1), arg2, ...rest);
      }
    };
  }
  logger.child = (bindings) => wrap(base.child(redact(bindings) || {}));
  logger.raw = base;
  return logger;
}

/**
 * Maakt de logger. Redigeert automatisch tokens/keys en schrijft optioneel
 * naar een bestand (JSON) én de console (pretty of JSON).
 * @param {object} config - gevalideerde agent-config
 */
function createLogger(config) {
  const pretty = isPrettyEnabled(config);
  const color = colorEnabled();

  const options = {
    level: config.logLevel,
    base: { name: 'mindgit-agent' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };

  let stream;
  if (config.logFile) {
    const streams = [
      { level: config.logLevel, stream: pino.destination({ dest: config.logFile, mkdir: true, sync: false }) },
      { level: config.logLevel, stream: pretty ? createPrettyStream({ color }) : process.stdout },
    ];
    stream = pino.multistream(streams);
  } else if (pretty) {
    stream = createPrettyStream({ color });
  } else {
    stream = process.stdout;
  }

  return wrap(pino(options, stream));
}

/** Stille logger (voor tests / CLI die zelf output doet). */
function createSilentLogger() {
  return createLogger({ logLevel: 'silent', logPretty: false, logFile: '' });
}

module.exports = {
  createLogger,
  createSilentLogger,
  formatLine,
  createPrettyStream,
  isPrettyEnabled,
  colorEnabled,
  LEVELS,
};
