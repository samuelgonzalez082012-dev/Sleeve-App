'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAgentOrchestrator } = require('../services/agent-orchestrator');

async function fixture(t, chat) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'lair-agent-test-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const events = [];
  const service = createAgentOrchestrator({
    fs, path, userData,
    openRouter: {
      chat,
      models: async () => [{ id: 'test/model', name: 'Test Model' }]
    },
    workspace: { getInfo: async () => null, list: async () => [], read: async () => '' },
    emit: async event => { events.push(event); return event; }
  });
  await service.load();
  return { service, events, userData };
}

test('Planner assigns developer work and Reviewer inspects proposals without writing files', async t => {
  const calls = [];
  const { service, events } = await fixture(t, async payload => {
    calls.push(payload.model);
    if (payload.model === 'planner') return { choices: [{ message: { content: JSON.stringify({
      plan: 'Implement a small file change', assignments: [{ agentId: 'developer-1', task: 'Create a file' }]
    }) } }] };
    if (payload.model === 'developer') return { choices: [{ message: { content: JSON.stringify({
      summary: 'Proposed the file', findings: ['One file proposed'], files: [{ path: 'hello.txt', mode: 'create', content: 'hello' }]
    }) } }] };
    return { choices: [{ message: { content: JSON.stringify({
      summary: 'The proposal looks safe', issues: [], approvedPaths: ['hello.txt']
    }) } }] };
  });
  await service.saveConfig({
    planner: { provider: 'openrouter', model: 'planner' },
    'developer-1': { provider: 'openrouter', model: 'developer' },
    'developer-2': { provider: 'openrouter', model: 'developer' },
    reviewer: { provider: 'openrouter', model: 'reviewer' }
  });
  const result = await service.run({ message: 'Create hello.txt' });
  assert.deepEqual(calls, ['planner', 'developer', 'reviewer']);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].review.approved, true);
  assert.equal(events.some(e => e.type === 'plan-created'), true);
  assert.equal(events.some(e => e.type === 'review-completed'), true);
});

test('Ollama model discovery rejects remote hosts', async t => {
  const { service } = await fixture(t, async () => ({ choices: [] }));
  await assert.rejects(service.listModels('ollama', 'http://example.com:11434'), /localhost/);
});

test('Team configuration persists independent provider and model choices', async t => {
  const { service, userData } = await fixture(t, async () => ({ choices: [] }));
  await service.saveConfig({
    planner: { provider: 'openrouter', model: 'planner-a' },
    'developer-1': { provider: 'ollama', model: 'qwen-coder', baseUrl: 'http://127.0.0.1:11434' },
    'developer-2': { provider: 'openrouter', model: 'dev-b' },
    reviewer: { provider: 'openrouter', model: 'review-c' }
  });
  await service.saveTemplate('Balanced team');
  await service.saveConfig({
    planner: { provider: 'openrouter', model: 'other-planner' },
    'developer-1': { provider: 'ollama', model: 'other-coder', baseUrl: 'http://127.0.0.1:11434' },
    'developer-2': { provider: 'openrouter', model: 'dev-b' },
    reviewer: { provider: 'openrouter', model: 'review-c' }
  });
  await service.loadTemplate('Balanced team');
  assert.deepEqual(await service.listTemplates(), ['Balanced team']);
  assert.equal(service.getConfig().planner.model, 'planner-a');
  const reloaded = createAgentOrchestrator({
    fs, path, userData,
    openRouter: { chat: async () => ({}), models: async () => [] },
    workspace: {}, emit: async e => e
  });
  await reloaded.load();
  assert.equal(service.getConfig()['developer-1'].provider, 'ollama');
  assert.equal(service.getConfig()['developer-1'].model, 'qwen-coder');
  assert.equal(reloaded.getConfig()['developer-1'].provider, 'ollama');
  assert.equal(reloaded.getConfig().planner.model, 'planner-a');
});


test('an individual recipient request cannot bypass Planner assignment authority', async t => {
  const calls = [];
  const { service } = await fixture(t, async payload => {
    calls.push(payload.model);
    return { choices: [{ message: { content: JSON.stringify({
      plan: 'Planner declined to delegate to the requested developer',
      assignments: [{ agentId: 'developer-1', task: 'Different task' }]
    }) } }] };
  });
  await service.saveConfig({
    planner: { provider: 'openrouter', model: 'planner' },
    'developer-1': { provider: 'openrouter', model: 'developer-1' },
    'developer-2': { provider: 'openrouter', model: 'developer-2' },
    reviewer: { provider: 'openrouter', model: 'reviewer' }
  });
  const result = await service.run({ message: 'Please ask Developer 2', to: 'developer-2' });
  assert.deepEqual(calls, ['planner']);
  assert.equal(result.assignments.length, 0);
  assert.match(result.needsUserInput, /Planner did not delegate/);
});
