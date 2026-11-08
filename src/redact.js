'use strict';

// Centrale redactie van geheimen. De agent krijgt per taak een GitHub-token en
// heeft zelf een node-key; die mogen nooit in logs of foutmeldingen belanden.

const SECRET_KEYS = /^(token|access_token|accessToken|authorization|auth|password|passwd|secret|node_?key|nodeKey|api_?key|private_?key)$/i;

// Herkenbare token-patronen (GitHub PAT's e.d.).
const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
];

const knownSecrets = new Set();

function registerSecret(value) {
  if (typeof value !== 'string') return;
  const v = value.trim();
  if (v.length >= 8) knownSecrets.add(v);
}

function redactString(input) {
  if (typeof input !== 'string' || input.length === 0) return input;
  let out = input;
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.split(secret).join('[REDACTED]');
  }
  for (const re of TOKEN_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

function redactValue(value, seen) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return '[Buffer]';

  const visited = seen || new WeakSet();
  if (visited.has(value)) return '[Circular]';
  visited.add(value);

  if (Array.isArray(value)) return value.map((v) => redactValue(v, visited));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redactValue(val, visited);
  }
  return out;
}

function redact(value) {
  return redactValue(value);
}

module.exports = {
  registerSecret,
  redactString,
  redact,
  SECRET_KEYS,
};
