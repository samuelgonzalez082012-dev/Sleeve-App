'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteFile } = require('./atomic-file');
const { sanitizeInputSchema, validateToolArguments } = require('./mcp-service');

const MAX_TOOLS = 300;
const MAX_AUDIT = 500;
const MAX_ARGUMENT_BYTES = 1_050_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value, label) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch (_) { throw new Error(label + ' must contain JSON-compatible values.'); }
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > MAX_ARGUMENT_BYTES) throw new Error(label + ' exceeds the 64 KB limit.');
  return JSON.parse(encoded);
}

function sanitizeSchema(schema) {
  return sanitizeInputSchema(schema || { type: 'object', properties: {} });
}

function validateArguments(schema, args) {
  if (!isPlainObject(args)) throw new Error('Tool arguments must be a JSON object.');
  const safeArgs = cloneJson(args, 'Tool arguments');
  return validateToolArguments(schema, safeArgs, { maxBytes: MAX_ARGUMENT_BYTES });
}

function normalizeDefinition(entry) {
  if (!isPlainObject(entry)) throw new Error('Tool registration entry must be an object.');
  const definition = isPlainObject(entry.definition) ? entry.definition : entry;
  const name = String(definition.name || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('Tool name must contain 1–64 letters, numbers, underscores or hyphens.');
  const description = String(definition.description || '').trim().slice(0, 1000);
  const parameters = sanitizeSchema(definition.parameters || { type: 'object', properties: {} });
  if (parameters.type !== 'object') throw new Error('Tool parameters must use an object schema.');
  return {
    name,
    description,
    parameters,
    source: ['builtin', 'mcp'].includes(entry.source) ? entry.source : 'builtin',
    category: String(entry.category || 'general').slice(0, 60),
    approval: String(entry.approval || 'policy').slice(0, 60)
  };
}

function createToolRegistry({ app }) {
  const auditPath = path.join(app.getPath('userData'), 'tool-audit.json');
  let registry = new Map();
  let history = [];
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const stat = await fs.lstat(auditPath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 512 * 1024) throw new Error('Tool audit log is not a supported file.');
      const parsed = JSON.parse(await fs.readFile(auditPath, 'utf8'));
      history = Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string').slice(-MAX_AUDIT) : [];
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load tool audit history:', error.message);
      history = [];
    }
  }

  function register(entries) {
    if (!Array.isArray(entries) || entries.length > MAX_TOOLS) throw new Error('Tool registration must be an array containing at most ' + MAX_TOOLS + ' tools.');
    const next = new Map();
    const errors = [];
    for (const entry of entries) {
      try {
        const item = normalizeDefinition(entry);
        if (next.has(item.name)) throw new Error('Duplicate tool name: ' + item.name);
        next.set(item.name, item);
      } catch (error) {
        errors.push(String(error.message || error).slice(0, 240));
      }
    }
    registry = next;
    return { registered: registry.size, rejected: errors.length, errors: errors.slice(0, 20) };
  }

  function list() {
    return [...registry.values()].map(item => ({
      name: item.name, description: item.description, source: item.source,
      category: item.category, approval: item.approval
    }));
  }

  function validate(name, args) {
    const item = registry.get(String(name || ''));
    if (!item) throw new Error('Tool is not in the current registered tool list.');
    return validateArguments(item.parameters, args === undefined ? {} : args);
  }

  async function persist() {
    const snapshot = JSON.stringify(history.slice(-MAX_AUDIT), null, 2);
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(auditPath), { recursive: true });
      await atomicWriteFile(auditPath, snapshot, { mode: 0o600 });
    });
    return writeQueue;
  }

  async function record(entry) {
    if (!isPlainObject(entry)) throw new Error('Invalid tool audit entry.');
    const name = String(entry.name || '').slice(0, 64);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('Invalid tool name in audit entry.');
    const statuses = ['completed', 'failed', 'blocked'];
    const status = statuses.includes(entry.status) ? entry.status : 'failed';
    const item = {
      id: crypto.randomUUID(),
      at: Date.now(),
      name,
      source: entry.source === 'mcp' ? 'mcp' : 'builtin',
      category: String(entry.category || 'general').slice(0, 60),
      status,
      durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.min(3_600_000, Math.round(entry.durationMs))) : null,
      error: String(entry.error || '').slice(0, 240)
    };
    history.push(item);
    history = history.slice(-MAX_AUDIT);
    await persist();
    return item;
  }

  function getAudit(limit = 100) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
    return history.slice(-safeLimit).reverse();
  }

  return { load, register, list, validate, record, getAudit };
}

module.exports = { createToolRegistry, sanitizeSchema, validateArguments, normalizeDefinition };