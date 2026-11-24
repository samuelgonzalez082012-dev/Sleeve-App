'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('OpenRouter is available as a dedicated provider with the official API base URL', () => {
  assert.match(index, /<option value="openrouter">OpenRouter<\/option>/);
  assert.match(renderer, /openrouter:\s*'https:\/\/openrouter\.ai\/api\/v1'/);
  assert.match(renderer, /\['openai','openrouter','anthropic'\]/);
});

test('OpenRouter model discovery uses the hosted catalog and exposes model pricing/context', () => {
  assert.match(renderer, /settings\.backend === 'openrouter' \? '\/models'/);
  assert.match(renderer, /meta\.pricing/);
  assert.match(renderer, /meta\.context_length/);
  assert.match(renderer, /formatOpenRouterPrice/);
  assert.match(renderer, /An OpenRouter API key is required/);
});

test('OpenRouter requests use Chat Completions and an app title header', () => {
  assert.match(renderer, /settings\.backend === 'openrouter' \? '\/chat\/completions'/);
  assert.match(renderer, /headers\['X-Title'\] = 'Local AI Runner'/);
  assert.ok(main.includes("['content-type','authorization','accept','x-api-key','anthropic-version','x-title'].includes(key)"));
});

test('main-process request validation permits only the required OpenRouter API routes', () => {
  assert.ok(main.includes('api\\/v1\\/(models|chat\\/completions)'));
});

test('OpenRouter setup is documented without embedding credentials', () => {
  assert.match(readme, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(readme, /OpenRouter API key/);
});
