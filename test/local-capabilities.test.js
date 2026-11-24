'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const renderer = read('renderer.js');

test('projects, memories, workflows and tasks persist in local collections', () => {
  for (const collection of ['projects', 'memories', 'workflows', 'tasks']) {
    assert.ok(renderer.includes(`saveCollection('${collection}'`), `missing local persistence for ${collection}`);
  }
  assert.match(renderer, /async function saveCollection\(key,value\)/);
});

test('scheduled local tasks wait until active model runs have released the run slot', () => {
  assert.match(renderer, /async function processScheduledTasks\(\)/);
  assert.match(renderer, /if \(running\.size\) return;/);
  assert.match(renderer, /task\.status==='scheduled'&&task\.due&&task\.due<=Date\.now\(\)/);
  assert.match(renderer, /await runTask\(task,\{showConversation:false\}\)/);
});

test('workspace search is exposed through trusted IPC and has bounded traversal', () => {
  const preload = read('preload.js');
  const main = read('main.js');
  const workspace = read('services/workspace-service.js');
  assert.match(preload, /search\(query, relativePath\) \{ return ipcRenderer\.invoke\('workspace:search'/);
  assert.match(main, /ipcMain\.handle\('workspace:search', async \(event,payload\) => \{ assertTrustedRenderer\(event\)/);
  assert.match(workspace, /visited >= 3000/);
  assert.match(workspace, /results\.length >= 40/);
});

test('browser integration is routed through the isolated browser API', () => {
  const preload = read('preload.js');
  const renderer = read('renderer.js');
  assert.match(preload, /navigate\(url\) \{ return ipcRenderer\.invoke\('browser:navigate'/);
  assert.match(preload, /action\(name\) \{ return ipcRenderer\.invoke\('browser:action'/);
  assert.match(renderer, /window\.localAI\.browser/);
});
