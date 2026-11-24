'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicWriteFile } = require('./atomic-file');

const MAX_MCP_TOOLS = 100;
const MAX_TOOL_ARGUMENT_BYTES = 200_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2025-11-25';
const CLIENT_INFO = Object.freeze({ name: 'Local AI Runner', version: '1.2.3' });
const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';

function validateEndpoint(value) {
  const url = new URL(String(value || ''));
  if (url.username || url.password) throw new Error('Do not put credentials in a connector URL.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('External MCP servers must use HTTPS. HTTP is only accepted for localhost.');
  }
  if (url.hash) throw new Error('Connector URLs cannot contain fragments.');
  return url;
}

function parseMcpResponse(contentType, body) {
  if (String(contentType).includes('text/event-stream')) {
    const data = String(body).split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean);
    for (let index = data.length - 1; index >= 0; index--) {
      try { return JSON.parse(data[index]); } catch (_) { /* Continue to the final parseable event. */ }
    }
    throw new Error('The MCP server returned an event stream without a JSON response.');
  }
  try { return JSON.parse(body); }
  catch (_) { throw new Error('The MCP server returned invalid JSON.'); }
}

async function readBoundedResponseText(response, maxBytes) {
  const announced = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(announced) && announced > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('MCP response exceeded the 2 MB limit.');
  }
  if (!response.body) {
    if (typeof response.text !== 'function') return '';
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Response exceeded its configured size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('MCP response exceeded the 2 MB limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function encodeHeaderValue(value) {
  const text = String(value);
  const safeAscii = /^[\x20-\x7e\t]*$/.test(text)
    && !/^[ \t]|[ \t]$/.test(text)
    && !/^=\?base64\?.*\?=$/.test(text);
  return safeAscii ? text : `=?base64?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function hasHeaderAnnotationOutsideProperties(schema) {
  const seen = new Set();
  function deepHasAnnotation(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(deepHasAnnotation);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'x-mcp-header' || deepHasAnnotation(child)) return true;
    }
    return false;
  }
  function inspectPropertySchema(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'x-mcp-header') continue; // The property's own annotation is checked separately.
      if (key === 'properties' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const nested of Object.values(child)) if (inspectPropertySchema(nested)) return true;
        continue;
      }
      if (deepHasAnnotation(child)) return true;
    }
    return false;
  }
  if (!schema || typeof schema !== 'object') return false;
  for (const [key, child] of Object.entries(schema)) {
    if (key === 'x-mcp-header') return true; // Root annotations are never valid.
    if (key === 'properties' && child && typeof child === 'object' && !Array.isArray(child)) {
      for (const propertySchema of Object.values(child)) if (inspectPropertySchema(propertySchema)) return true;
      continue;
    }
    if (deepHasAnnotation(child)) return true;
  }
  return false;
}

function collectHeaderAnnotations(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { valid: true, annotations: [] };
  const annotations = [];
  const usedNames = new Set();
  let invalidReason = '';

  function walk(node, propertyPath) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (Object.prototype.hasOwnProperty.call(node, 'x-mcp-header')) {
      const name = node['x-mcp-header'];
      const types = Array.isArray(node.type) ? node.type.filter(type => type !== 'null') : [node.type];
      const primitive = types.length === 1 && ['string', 'integer', 'boolean'].includes(types[0]);
      if (!propertyPath.length || typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !primitive) {
        invalidReason = 'An x-mcp-header annotation has an invalid name, location or primitive type.';
        return;
      }
      const normalized = name.toLowerCase();
      if (usedNames.has(normalized)) {
        invalidReason = 'An input schema contains duplicate x-mcp-header names.';
        return;
      }
      usedNames.add(normalized);
      annotations.push({ name, path: propertyPath.slice(), type: types[0] });
    }

    if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
      for (const [key, child] of Object.entries(node.properties)) {
        walk(child, [...propertyPath, key]);
        if (invalidReason) return;
      }
    }
  }

  walk(schema, []);
  if (!invalidReason && hasHeaderAnnotationOutsideProperties(schema)) {
    invalidReason = 'x-mcp-header annotations must be attached to directly addressable object properties.';
  }
  return { valid: !invalidReason, reason: invalidReason, annotations };
}

function extractMcpHeaderValues(schema, args) {
  const validation = collectHeaderAnnotations(schema);
  if (!validation.valid) throw new Error(validation.reason);
  const headers = {};
  for (const annotation of validation.annotations) {
    let value = args;
    for (const key of annotation.path) value = value && typeof value === 'object' ? value[key] : undefined;
    if (value === undefined || value === null) continue;
    if (annotation.type === 'string' && typeof value !== 'string') throw new Error(`MCP parameter ${annotation.path.join('.')} must be a string.`);
    if (annotation.type === 'integer' && (!Number.isSafeInteger(value))) throw new Error(`MCP parameter ${annotation.path.join('.')} must be a safe integer.`);
    if (annotation.type === 'boolean' && typeof value !== 'boolean') throw new Error(`MCP parameter ${annotation.path.join('.')} must be a boolean.`);
    const headerName = `Mcp-Param-${annotation.name}`;
    headers[headerName] = encodeHeaderValue(value);
  }
  return headers;
}

const MAX_SCHEMA_DEPTH = 20;
const MAX_SCHEMA_NODES = 2500;
const MAX_ARGUMENT_DEPTH = 20;
const MAX_ARGUMENT_NODES = 5000;
const FORBIDDEN_SCHEMA_KEYS = new Set(['__proto__', 'prototype', 'constructor', '$ref', '$dynamicRef', '$recursiveRef']);
const ALLOWED_SCHEMA_KEYS = new Set([
  'type', 'title', 'description', 'default', 'examples', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
  'x-mcp-header'
]);

function isSafeSchemaPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 256) return false;
  // Accept a deliberately conservative subset. No backreferences, lookarounds,
  // quantified groups, alternation combined with repetition, or chains of
  // backtracking quantifiers from an untrusted remote tool schema.
  if (/\\[1-9]|\(\?[=!<]|\([^)]*\)[+*{]|\([^)]*\|[^)]*\)[+*{]/.test(pattern)) return false;
  const quantifiers = pattern.match(/[+*?]|\{\d+(?:,\d*)?\}/g) || [];
  if (quantifiers.length > 1) return false;
  if (quantifiers.length && pattern.includes('|')) return false;
  try { new RegExp(pattern); return true; } catch (_) { return false; }
}

function sanitizeInputSchema(schema) {
  let nodes = 0;
  function visit(node, depth, isRoot = false) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('MCP input schema must be a JSON object.');
    if (depth > MAX_SCHEMA_DEPTH || ++nodes > MAX_SCHEMA_NODES) throw new Error('MCP input schema exceeds its complexity limit.');
    const output = Object.create(null);
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_SCHEMA_KEYS.has(key)) throw new Error(`MCP input schema contains forbidden key “${key}”.`);
      if (!ALLOWED_SCHEMA_KEYS.has(key)) throw new Error(`MCP input schema uses unsupported keyword “${key}”. The tool was excluded rather than applying weaker validation.`);
      if (key === 'properties') {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200) throw new Error('MCP schema properties must be a bounded object.');
        const properties = Object.create(null);
        for (const [name, child] of Object.entries(value)) {
          if (!name || name.length > 128 || FORBIDDEN_SCHEMA_KEYS.has(name)) throw new Error('MCP schema contains an invalid property name.');
          properties[name] = visit(child, depth + 1);
        }
        output.properties = properties;
      } else if (key === 'items' || key === 'additionalProperties' && value && typeof value === 'object') {
        output[key] = visit(value, depth + 1);
      } else if (key === 'required') {
        if (!Array.isArray(value) || value.length > 200 || value.some(name => typeof name !== 'string' || !name || name.length > 128)) throw new Error('MCP schema required list is invalid.');
        output.required = [...new Set(value)];
      } else if (key === 'type') {
        const types = Array.isArray(value) ? value : [value];
        const allowed = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
        if (!types.length || types.length > 7 || types.some(type => !allowed.has(type))) throw new Error('MCP schema has an unsupported value type.');
        output.type = Array.isArray(value) ? [...new Set(types)] : value;
      } else if (key === 'enum') {
        if (!Array.isArray(value) || value.length > 100) throw new Error('MCP schema enum is invalid or too large.');
        const serialized = JSON.stringify(value);
        if (serialized.length > 20_000) throw new Error('MCP schema enum value is too large.');
        output.enum = JSON.parse(serialized);
      } else if (key === 'const' || key === 'default' || key === 'examples') {
        const serialized = JSON.stringify(value);
        if (serialized === undefined || serialized.length > 20_000) throw new Error(`MCP schema ${key} value is too large.`);
        output[key] = JSON.parse(serialized);
      } else if (key === 'additionalProperties') {
        if (typeof value !== 'boolean') throw new Error('MCP schema additionalProperties must be a boolean or schema.');
        output[key] = value;
      } else if (key === 'pattern') {
        if (!isSafeSchemaPattern(value)) throw new Error('MCP schema contains an unsafe or invalid pattern.');
        output.pattern = value;
      } else if (key === 'x-mcp-header') {
        if (typeof value !== 'string' || value.length > 64) throw new Error('MCP header annotation is invalid.');
        output[key] = value;
      } else if (key === 'title' || key === 'description') {
        if (typeof value !== 'string' || value.length > (key === 'description' ? 2000 : 120)) throw new Error(`MCP schema ${key} is invalid.`);
        output[key] = value;
      } else if (key === 'uniqueItems') {
        if (typeof value !== 'boolean') throw new Error('MCP schema uniqueItems must be boolean.');
        output[key] = value;
      } else {
        const integerBounds = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'];
        if (!Number.isFinite(value) || Math.abs(value) > 1e12 || value < 0 && integerBounds.includes(key) || integerBounds.includes(key) && !Number.isInteger(value)) throw new Error(`MCP schema ${key} is invalid.`);
        output[key] = value;
      }
    }
    if (isRoot && output.type && !(['object'].includes(output.type) || Array.isArray(output.type) && output.type.includes('object'))) throw new Error('MCP tool input schema must describe an object.');
    if (output.minLength !== undefined && output.maxLength !== undefined && output.minLength > output.maxLength) throw new Error('MCP schema string length bounds are inconsistent.');
    if (output.minItems !== undefined && output.maxItems !== undefined && output.minItems > output.maxItems) throw new Error('MCP schema array bounds are inconsistent.');
    if (output.minProperties !== undefined && output.maxProperties !== undefined && output.minProperties > output.maxProperties) throw new Error('MCP schema object bounds are inconsistent.');
    return output;
  }
  return visit(schema || { type: 'object', properties: {} }, 0, true);
}

function validateToolArguments(schema, args, { maxBytes = MAX_TOOL_ARGUMENT_BYTES } = {}) {
  const safeSchema = sanitizeInputSchema(schema || { type: 'object', properties: {} });
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('External tool arguments must be a JSON object.');
  let serialized;
  try { serialized = JSON.stringify(args); } catch (_) { throw new Error('External tool arguments must be JSON-serializable.'); }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error('External tool arguments exceed the configured size limit.');
  const safeArgs = JSON.parse(serialized);
  let nodes = 0;
  function fail(path, reason) { throw new Error(`Invalid MCP tool arguments at ${path || '$'}: ${reason}`); }
  function visit(value, rule, location, depth) {
    if (depth > MAX_ARGUMENT_DEPTH || ++nodes > MAX_ARGUMENT_NODES) fail(location, 'argument structure is too complex.');
    const types = rule?.type === undefined ? [] : Array.isArray(rule.type) ? rule.type : [rule.type];
    const matches = type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
    if (types.length && !types.some(matches)) fail(location, `expected ${types.join(' or ')}.`);
    if (rule?.enum && !rule.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) fail(location, 'value is not an allowed option.');
    if (Object.prototype.hasOwnProperty.call(rule || {}, 'const') && JSON.stringify(rule.const) !== JSON.stringify(value)) fail(location, 'value does not match the required constant.');
    if (typeof value === 'string') {
      const length = [...value].length;
      if (rule.minLength !== undefined && length < rule.minLength) fail(location, `must contain at least ${rule.minLength} characters.`);
      if (rule.maxLength !== undefined && length > rule.maxLength) fail(location, `must contain no more than ${rule.maxLength} characters.`);
      if (rule.pattern && (value.length > 10_000 || !new RegExp(rule.pattern).test(value))) fail(location, 'does not match the required format or exceeds the pattern-check limit.');
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (rule.minimum !== undefined && value < rule.minimum) fail(location, `must be at least ${rule.minimum}.`);
      if (rule.maximum !== undefined && value > rule.maximum) fail(location, `must be no more than ${rule.maximum}.`);
      if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum) fail(location, `must be greater than ${rule.exclusiveMinimum}.`);
      if (rule.exclusiveMaximum !== undefined && value >= rule.exclusiveMaximum) fail(location, `must be less than ${rule.exclusiveMaximum}.`);
    }
    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems) fail(location, `must contain at least ${rule.minItems} items.`);
      if (rule.maxItems !== undefined && value.length > rule.maxItems) fail(location, `must contain no more than ${rule.maxItems} items.`);
      if (rule.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail(location, 'must not contain duplicate items.');
      if (rule.items) value.forEach((item, index) => visit(item, rule.items, `${location}[${index}]`, depth + 1));
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value); const properties = rule.properties || {};
      if (rule.minProperties !== undefined && keys.length < rule.minProperties) fail(location, `must contain at least ${rule.minProperties} properties.`);
      if (rule.maxProperties !== undefined && keys.length > rule.maxProperties) fail(location, `must contain no more than ${rule.maxProperties} properties.`);
      for (const required of rule.required || []) if (!Object.prototype.hasOwnProperty.call(value, required)) fail(`${location}.${required}`, 'is required.');
      for (const key of keys) {
        if (FORBIDDEN_SCHEMA_KEYS.has(key)) fail(`${location}.${key}`, 'is a forbidden property name.');
        if (Object.prototype.hasOwnProperty.call(properties, key)) visit(value[key], properties[key], `${location}.${key}`, depth + 1);
        else if (rule.additionalProperties === false) fail(`${location}.${key}`, 'is not an allowed property.');
        else if (rule.additionalProperties && typeof rule.additionalProperties === 'object') visit(value[key], rule.additionalProperties, `${location}.${key}`, depth + 1);
        else visit(value[key], {}, `${location}.${key}`, depth + 1);
      }
    }
  }
  visit(safeArgs, safeSchema, '$', 0);
  return safeArgs;
}

function safeToolArgsForApproval(args) {
  const secretKey = /(password|passwd|secret|token|api[-_]?key|authorization|credential)/i;
  function redact(value, depth = 0) {
    if (depth > 5) return '[nested value omitted]';
    if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, depth + 1));
    if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 300) : value;
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 30)) {
      output[key] = secretKey.test(key) ? '[hidden]' : redact(entry, depth + 1);
    }
    return output;
  }
  const serialized = JSON.stringify(redact(args), null, 2);
  return serialized.length > 1_400 ? `${serialized.slice(0, 1_400)}\n…[preview truncated]` : serialized;
}

function isModernProtocolError(error) {
  return Boolean(error && error.rpcCode !== undefined && [-32601, -32020, -32021, -32022].includes(error.rpcCode));
}

function createMcpService({ app, dialog, fetchImpl = globalThis.fetch }) {
  const filePath = path.join(app.getPath('userData'), 'mcp-servers.json');
  const sessions = new Map();
  const catalogs = new Map();
  const protocols = new Map();
  let servers = [];
  let nextId = 0;

  async function load() {
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256 * 1024) throw new Error('MCP configuration file is invalid or exceeds its 256 KB limit.');
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      servers = Array.isArray(parsed) ? parsed.slice(0, 100).filter(entry => {
        if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.url !== 'string') return false;
        try { validateEndpoint(entry.url); return true; } catch (_) { return false; }
      }) : [];
    } catch (_) { servers = []; }
  }

  async function persist() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await atomicWriteFile(filePath, JSON.stringify(servers, null, 2), { mode: 0o600 });
  }

  function safeServer(id) {
    const server = servers.find(entry => entry.id === id);
    if (!server) throw new Error('Connector not found.');
    validateEndpoint(server.url);
    return server;
  }

  function modernParams(params = {}) {
    return {
      ...params,
      _meta: {
        [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION,
        [META_CLIENT_INFO]: CLIENT_INFO,
        [META_CLIENT_CAPABILITIES]: {}
      }
    };
  }

  async function sendRequest(server, method, params = {}, era = 'modern', schema = null, notification = false) {
    const url = validateEndpoint(server.url);
    const id = notification ? undefined : ++nextId;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };
    const payload = { jsonrpc: '2.0', method, params: era === 'modern' ? modernParams(params) : params };
    if (id !== undefined) payload.id = id;

    if (era === 'modern') {
      headers['MCP-Protocol-Version'] = MODERN_PROTOCOL_VERSION;
      headers['Mcp-Method'] = method;
      const namedValue = params.name ?? params.uri;
      if (namedValue !== undefined) headers['Mcp-Name'] = encodeHeaderValue(namedValue);
      if (method === 'tools/call' && schema) Object.assign(headers, extractMcpHeaderValues(schema, params.arguments || {}));
    } else {
      const sessionId = sessions.get(server.id);
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetchImpl(url.href, {
        method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal, redirect: 'error'
      });
      const responseText = await readBoundedResponseText(response, MAX_RESPONSE_BYTES);

      if (era === 'legacy') {
        const sessionId = response.headers?.get?.('mcp-session-id');
        if (sessionId) sessions.set(server.id, sessionId);
        if (!response.ok && response.status !== 202) throw new Error(`MCP HTTP ${response.status}: ${responseText.slice(0, 250)}`);
        if (notification || response.status === 202 || response.status === 204) return {};
      } else if (!response.ok) {
        let parsed = null;
        try { parsed = parseMcpResponse(response.headers?.get?.('content-type') || '', responseText); } catch (_) { /* Preserve HTTP fallback signal. */ }
        const error = new Error(`MCP HTTP ${response.status}${parsed?.error?.message ? `: ${parsed.error.message}` : ''}`);
        error.httpStatus = response.status;
        if (parsed?.error) error.rpcCode = parsed.error.code;
        throw error;
      }

      const result = parseMcpResponse(response.headers?.get?.('content-type') || '', responseText);
      if (result.error) {
        const error = new Error(result.error.message || 'MCP request failed.');
        error.rpcCode = result.error.code;
        error.rpcData = result.error.data;
        throw error;
      }
      if (id !== undefined && result.id !== undefined && result.id !== id) throw new Error('The MCP server returned a response for a different request.');
      const value = result.result || {};
      if (era === 'modern' && value.resultType === 'input_required') {
        throw new Error('This MCP tool requires additional user input. Multi-round-trip MCP interactions are not supported by this connector yet.');
      }
      if (era === 'modern' && value.resultType && value.resultType !== 'complete') {
        throw new Error(`The MCP server returned unsupported result type “${String(value.resultType).slice(0, 60)}”.`);
      }
      return value;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('MCP request timed out after 25 seconds.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function listTools(server, era) {
    const response = await sendRequest(server, 'tools/list', {}, era);
    const rawTools = Array.isArray(response.tools) ? response.tools.slice(0, MAX_MCP_TOOLS) : [];
    const valid = [];
    for (const tool of rawTools) {
      if (!tool || typeof tool.name !== 'string' || !tool.name.trim() || tool.name.length > 128) continue;
      let schema;
      try { schema = sanitizeInputSchema(tool.inputSchema || { type: 'object', properties: {} }); }
      catch (error) { console.warn(`Excluded invalid MCP tool “${tool.name}”: ${error.message}`); continue; }
      const annotationCheck = collectHeaderAnnotations(schema);
      if (!annotationCheck.valid) {
        console.warn(`Excluded invalid MCP tool “${tool.name}”: ${annotationCheck.reason}`);
        continue;
      }
      valid.push({ ...tool, inputSchema: schema });
    }
    catalogs.set(server.id, valid);
    protocols.set(server.id, era);
    return valid;
  }

  async function initializeLegacyServer(server) {
    const initialized = await sendRequest(server, 'initialize', {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO
    }, 'legacy');
    const negotiated = initialized.protocolVersion;
    if (typeof negotiated === 'string') server.legacyProtocolVersion = negotiated;
    await sendRequest(server, 'notifications/initialized', {}, 'legacy', null, true).catch(error => {
      // Some legacy servers return no-content (rather than 202) for notifications.
      if (!/invalid JSON|without a JSON response/i.test(error.message)) throw error;
    });
    return listTools(server, 'legacy');
  }

  async function initializeServer(server) {
    // Probe the current stateless protocol first. Discovery is optional, so if a
    // modern server does not implement it we verify support with tools/list.
    try {
      try {
        await sendRequest(server, 'server/discover', {}, 'modern');
      } catch (error) {
        if (!isModernProtocolError(error)) throw error;
        if (error.rpcCode !== -32601) throw error;
        await sendRequest(server, 'tools/list', {}, 'modern');
      }
      return await listTools(server, 'modern');
    } catch (modernError) {
      if (isModernProtocolError(modernError) && modernError.rpcCode !== -32601) throw modernError;
      // Legacy servers generally reject modern request metadata or return a
      // non-JSON HTTP error. Only then attempt the initialize handshake.
      try {
        return await initializeLegacyServer(server);
      } catch (legacyError) {
        const reason = modernError.message || 'modern protocol not accepted';
        throw new Error(`Could not connect using MCP 2026-07-28 or the legacy handshake. Modern attempt: ${reason}. Legacy attempt: ${legacyError.message}`);
      }
    }
  }

  function presentServer(server, tools, error = '') {
    return {
      ...server,
      protocol: protocols.get(server.id) === 'modern' ? MODERN_PROTOCOL_VERSION : protocols.get(server.id) === 'legacy' ? (server.legacyProtocolVersion || LEGACY_PROTOCOL_VERSION) : 'unknown',
      tools: tools.map(tool => ({
        name: tool.name,
        description: String(tool.description || '').slice(0, 500),
        inputSchema: tool.inputSchema || { type: 'object', properties: {} }
      })),
      error
    };
  }

  async function add(owner, { name, url: endpoint }) {
    const url = validateEndpoint(endpoint);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    if (!local) {
      const answer = await dialog.showMessageBox(owner, {
        type: 'warning', buttons: ['Connect', 'Cancel'], cancelId: 1, defaultId: 1,
        title: 'Connect external tool server?',
        message: `Allow Local AI Runner to contact ${url.origin}?`,
        detail: 'The server may receive tool requests, prompts and selected context. Only connect to a server you trust. You can disconnect it later.'
      });
      if (answer.response !== 0) return null;
    }
    const server = {
      id: randomUUID().slice(0, 12),
      name: String(name || 'MCP server').trim().slice(0, 60),
      url: url.href
    };
    if (!server.name) throw new Error('Enter a connection name.');
    const tools = await initializeServer(server);
    servers.push(server);
    await persist();
    return presentServer(server, tools);
  }

  async function list() {
    const output = [];
    for (const server of servers) {
      try {
        const tools = await initializeServer(server);
        output.push(presentServer(server, tools));
      } catch (error) {
        output.push(presentServer(server, catalogs.get(server.id) || [], error.message));
      }
    }
    return output;
  }

  async function remove(id) {
    servers = servers.filter(server => server.id !== id);
    sessions.delete(id);
    catalogs.delete(id);
    protocols.delete(id);
    await persist();
    return true;
  }

  async function call(owner, { serverId, toolName, args }) {
    const server = safeServer(serverId);
    const safeName = String(toolName || '').trim();
    if (!safeName || safeName.length > 128) throw new Error('Invalid external tool name.');
    const providedArgs = args === undefined ? {} : args;
    const catalog = catalogs.get(server.id) || [];
    let definition = catalog.find(tool => tool.name === safeName);
    if (!definition) {
      await initializeServer(server);
      definition = (catalogs.get(server.id) || []).find(tool => tool.name === safeName);
    }
    if (!definition) throw new Error('That tool is not in the server’s current advertised tool list. Refresh the connection and try again.');
    const safeArgs = validateToolArguments(definition.inputSchema, providedArgs);
    const preview = safeToolArgsForApproval(safeArgs);
    const answer = await dialog.showMessageBox(owner, {
      type: 'question', buttons: ['Run tool', 'Cancel'], cancelId: 1, defaultId: 1,
      title: 'Approve external tool call?',
      message: `Run “${safeName.slice(0, 100)}” on ${server.name}?`,
      detail: `The external server may receive these arguments. Review them carefully before approving:\n\n${preview}\n\nThe server may also receive other context explicitly included in the tool arguments.`
    });
    if (answer.response !== 0) throw new Error('External tool call cancelled.');
    const era = protocols.get(server.id) || 'modern';
    const result = await sendRequest(server, 'tools/call', { name: safeName, arguments: safeArgs }, era, definition.inputSchema);
    return result;
  }

  return { load, add, list, remove, call };
}

module.exports = {
  createMcpService,
  validateEndpoint,
  parseMcpResponse,
  collectHeaderAnnotations,
  extractMcpHeaderValues,
  sanitizeInputSchema,
  validateToolArguments,
  safeToolArgsForApproval,
  encodeHeaderValue,
  MODERN_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSION
};
