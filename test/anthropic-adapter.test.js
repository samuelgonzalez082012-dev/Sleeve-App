'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toWire, toolDefinition } = require('../anthropic-adapter');

test('converts system messages and preserves ordered text turns', () => {
  const result = toWire([
    { role: 'system', content: 'System rule one.' },
    { role: 'system', content: 'System rule two.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' }
  ]);
  assert.equal(result.system, 'System rule one.\n\nSystem rule two.');
  assert.deepEqual(result.messages, [
    { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }
  ]);
});

test('converts image data URLs into supported Anthropic image blocks', () => {
  const result = toWire([{ role: 'user', content: 'Describe this', images: ['data:image/png;base64,YWJj', 'data:image/svg+xml;base64,PHN2Zz4='] }]);
  assert.deepEqual(result.messages[0].content, [
    { type: 'text', text: 'Describe this' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }
  ]);
});

test('converts assistant tool calls and groups tool results into a user turn', () => {
  const result = toWire([
    { role: 'assistant', content: 'I will inspect that.', tool_calls: [{ id: 'toolu_123', name: 'read_file', args: { path: 'README.md' } }] },
    { role: 'tool', tool_call_id: 'toolu_123', content: 'file contents' },
    { role: 'tool', tool_call_id: 'toolu_456', content: 'second result' }
  ]);
  assert.deepEqual(result.messages[0].content[1], { type: 'tool_use', id: 'toolu_123', name: 'read_file', input: { path: 'README.md' } });
  assert.deepEqual(result.messages[1], {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_123', content: 'file contents' },
      { type: 'tool_result', tool_use_id: 'toolu_456', content: 'second result' }
    ]
  });
});

test('maps canonical registry definitions to Anthropic input_schema', () => {
  const definition = { name: 'search', description: 'Search workspace', parameters: { type: 'object', properties: { query: { type: 'string' } } } };
  assert.deepEqual(toolDefinition(definition), {
    name: 'search',
    description: 'Search workspace',
    input_schema: definition.parameters
  });
  assert.throws(() => toolDefinition({}));
});
