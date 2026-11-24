'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildToolFallbackPrompt, parseToolFallbackResponse, MAX_CALLS } = require('../tool-fallback');

test('builds a compact tool guide from canonical definitions', () => {
  const result = buildToolFallbackPrompt([
    { definition: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { definition: { name: 'search_files', description: 'Search files', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }
  ]);
  assert.match(result.prompt, /<tool_calls>/);
  assert.deepEqual(result.names, ['read_file', 'search_files']);
  assert.match(result.prompt, /"path"/);
});

test('extracts structured calls and removes the execution block from visible output', () => {
  const source = 'I will check that now.\n<tool_calls>\n{"calls":[{"name":"read_file","arguments":{"path":"README.md"}}]}\n </tool_calls>';
  const parsed = parseToolFallbackResponse(source);
  assert.equal(parsed.content, 'I will check that now.');
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].name, 'read_file');
  assert.deepEqual(parsed.calls[0].args, { path: 'README.md' });
});

test('accepts several calls but enforces the bounded call limit', () => {
  const calls = Array.from({ length: MAX_CALLS }, (_, i) => ({ name: 'tool_' + i, arguments: {} }));
  assert.equal(parseToolFallbackResponse('<tool_calls>' + JSON.stringify({ calls }) + '</tool_calls>').calls.length, MAX_CALLS);
  calls.push({ name: 'extra', arguments: {} });
  assert.equal(parseToolFallbackResponse('<tool_calls>' + JSON.stringify({ calls }) + '</tool_calls>'), null);
});

test('rejects malformed JSON, non-object arguments, and unsafe tool names', () => {
  assert.equal(parseToolFallbackResponse('<tool_calls>{bad}</tool_calls>'), null);
  assert.equal(parseToolFallbackResponse('<tool_calls>' + JSON.stringify({ calls: [{ name: 'read_file', arguments: [] }] }) + '</tool_calls>'), null);
  assert.equal(parseToolFallbackResponse('<tool_calls>' + JSON.stringify({ calls: [{ name: 'bad tool!', arguments: {} }] }) + '</tool_calls>'), null);
});

test('does not interpret ordinary JSON or fenced examples as tool execution requests', () => {
  assert.equal(parseToolFallbackResponse('{name: "read_file","arguments":{"path":"README.md"}}'), null);
  assert.equal(parseToolFallbackResponse('```json\n{"calls":[{"name":"read_file","arguments":{}}]}\n```'), null);
});