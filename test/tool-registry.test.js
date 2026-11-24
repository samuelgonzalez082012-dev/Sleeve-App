'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createToolRegistry, sanitizeSchema, validateArguments } = require('../services/tool-registry');

test('sanitizes supported JSON schema definitions and rejects unsafe shapes', () => {
  const schema = sanitizeSchema({ type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['count'], additionalProperties: false });
  assert.equal(schema.properties.count.maximum, 5);
  assert.throws(() => sanitizeSchema(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')));
  assert.throws(() => sanitizeSchema({ type: 'object', properties: { a: { type: 'not-a-type' } } }));
});

test('validates required fields, types, bounds and additional properties', () => {
  const schema = sanitizeSchema({ type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 5 }, mode: { type: 'string', enum: ['fast', 'safe'] } }, required: ['count'], additionalProperties: false });
  assert.deepEqual(validateArguments(schema, { count: 3, mode: 'safe' }), { count: 3, mode: 'safe' });
  assert.throws(() => validateArguments(schema, { mode: 'fast' }), /required/);
  assert.throws(() => validateArguments(schema, { count: 0 }), /at least/);
  assert.throws(() => validateArguments(schema, { count: 2.5 }), /integer/);
  assert.throws(() => validateArguments(schema, { count: 2, extra: true }), /not an allowed property/);
  assert.throws(() => validateArguments(schema, { count: 2, mode: 'unsafe' }), /allowed option/);
});

test('validates nested arrays and object shapes', () => {
  const schema = sanitizeSchema({ type: 'object', properties: { entries: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'object', properties: { label: { type: 'string', minLength: 2 } }, required: ['label'], additionalProperties: false } } }, required: ['entries'] });
  assert.doesNotThrow(() => validateArguments(schema, { entries: [{ label: 'ok' }] }));
  assert.throws(() => validateArguments(schema, { entries: [] }), /at least/);
  assert.throws(() => validateArguments(schema, { entries: [{ label: 'x' }] }), /at least/);
});

test('registry rejects duplicate names and validates only registered tools', () => {
  const registry = createToolRegistry({ app: { getPath: () => path.join(os.tmpdir(), 'local-ai-runner-tool-registry-test') } });
  const definition = { name: 'sample_tool', description: 'Test', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } };
  const result = registry.register([{ definition }, { definition }]);
  assert.equal(result.registered, 1);
  assert.equal(result.rejected, 1);
  assert.deepEqual(registry.validate('sample_tool', { value: 'ok' }), { value: 'ok' });
  assert.throws(() => registry.validate('unknown_tool', {}), /not in the current/);
});

test('audit history persists outcomes without saving argument payloads', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-tool-audit-'));
  const app = { getPath: () => directory };
  const registry = createToolRegistry({ app });
  await registry.load();
  await registry.record({ name: 'read_file', source: 'builtin', category: 'workspace.read', status: 'completed', durationMs: 14, secretArgument: 'not saved' });
  const again = createToolRegistry({ app });
  await again.load();
  const audit = again.getAudit();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].name, 'read_file');
  assert.equal(audit[0].durationMs, 14);
  assert.equal(Object.hasOwn(audit[0], 'secretArgument'), false);
  await fs.rm(directory, { recursive: true, force: true });
});