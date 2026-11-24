'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Work Manager execution is bounded, interruptible and permission checked', () => {
  const work = read('work-manager.js');
  const renderer = read('renderer.js');
  const main = read('main.js');
  assert.match(work, /parsePlannerPlan\(/);
  assert.match(work, /state\.memory\.filter\(item=>item\.status==='approved'\)/);
  assert.match(work, /Promise\.allSettled\(/);
  assert.match(work, /waitIfPaused/);
  assert.match(work, /userStopped/);
  assert.match(main, /requestingAgent\.tools\.includes\('write-proposal'\)/);
  assert.match(renderer, /AbortSignal\.timeout/);
  assert.match(renderer, /maxTokensOverride/);
});

test('Ollama remains the default and model downloads use the trusted pull bridge', () => {
  const renderer = read('renderer.js');
  const main = read('main.js');
  const index = read('index.html');
  assert.match(renderer, /settings\.backend = \['openai','openrouter','anthropic'\]\.includes\(settings\.backend\) \? settings\.backend : 'ollama'/);
  assert.match(renderer, /pullOllamaModel/);
  assert.match(renderer, /api\/pull/);
  assert.ok(main.includes('|pull)'));
  assert.match(index, /id="modelPullForm"/);
  assert.match(index, /id="browseOllamaLibrary"/);
  assert.match(renderer, /VRAM is not included/);
});

test('per-agent model routing keeps hosted models optional and credentials encrypted', () => {
  const work = read('work-manager.js');
  const renderer = read('renderer.js');
  const service = read('services/openrouter-service.js');
  const index = read('index.html');
  assert.match(work, /inspectAgentProvider/);
  assert.match(work, /listProviderModels/);
  assert.ok(renderer.includes('providerOverride||settings.backend'));
  assert.match(service, /secureStorageAvailable/);
  assert.match(service, /An OpenRouter API key is required/);
  assert.match(index, /Ollama \(local\)/);
  assert.match(index, /OpenRouter/);
});

test('navigation enhancements and editor search are present', () => {
  const ux = read('ux-enhancements.js');
  const index = read('index.html');
  const editor = read('editor-ui.js');
  assert.ok(index.includes('Ctrl+Shift+P'));
  assert.match(ux, /settingsSearch/);
  assert.match(index, /commandPaletteOpen/);
  assert.match(editor, /workspace\.search\(term\)/);
  assert.match(editor, /response\.capped/);
  assert.match(editor, /setSelectionRange\(offset/);
});
