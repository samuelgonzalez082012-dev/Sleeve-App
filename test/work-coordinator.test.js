'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWorkCoordinator } = require('../services/work-coordinator');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lair-work-'));
  const app = { getPath: () => directory };
  const workspace = { getInfo: () => ({ path: path.join(directory, 'project') }) };
  const service = createWorkCoordinator({ app, workspace });
  await service.load();
  return { service, directory };
}

test('loads a default four-agent team and persists custom team templates', async () => {
  const { service, directory } = await fixture();
  try {
    const initial = service.getState();
    assert.deepEqual(initial.team.agents.map(agent => agent.id), ['planner','developer-1','developer-2','reviewer']);
    await service.saveTemplate('QA team');
    const restored = createWorkCoordinator({ app: { getPath: () => directory }, workspace: { getInfo: () => ({ path: path.join(directory, 'project') }) } });
    await restored.load();
    assert.equal(restored.getState().templates[0].name, 'QA team');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('persists tasks and shared project memory', async () => {
  const { service, directory } = await fixture();
  try {
    const task = await service.createTask({ title: 'Review app', description: 'Inspect the application', assignedTo: 'reviewer' });
    await service.updateTask(task.id, { status: 'review' });
    await service.addMemory({ title: 'Architecture', content: 'Electron main process owns filesystem access.', category: 'architecture' });
    const restored = createWorkCoordinator({ app: { getPath: () => directory }, workspace: { getInfo: () => ({ path: path.join(directory, 'project') }) } });
    await restored.load();
    assert.equal(restored.getState().tasks[0].status, 'review');
    assert.equal(restored.getState().memory[0].category, 'architecture');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('grants shared reads, queues conflicting writes, and releases locks', async () => {
  const { service, directory } = await fixture();
  try {
    const read1 = service.acquireLock({ path: 'src/app.js', agentId: 'developer-1', mode: 'read' });
    const read2 = service.acquireLock({ path: 'src/app.js', agentId: 'reviewer', mode: 'read' });
    const write = service.acquireLock({ path: 'src/app.js', agentId: 'developer-2', mode: 'write' });
    assert.equal(read1.acquired, true);
    assert.equal(read2.acquired, true);
    assert.equal(write.queued, true);
    service.releaseLock(read1.lock.id);
    service.releaseLock(read2.lock.id);
    assert.equal(service.getState().locks[0].mode, 'write');
    assert.equal(service.getState().locks[0].agentId, 'developer-2');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('rejects paths outside the project and unknown agents', async () => {
  const { service, directory } = await fixture();
  try {
    assert.throws(() => service.acquireLock({ path: '../secrets.txt', agentId: 'planner', mode: 'write' }), /Invalid workspace-relative/);
    assert.throws(() => service.acquireLock({ path: 'safe.txt', agentId: 'stranger', mode: 'read' }), /Unknown agent/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('queued writers are not bypassed by later readers', async () => {
  const { service, directory } = await fixture();
  try {
    const firstRead = service.acquireLock({ path: 'src/shared.js', agentId: 'developer-1', mode: 'read' });
    const queuedWrite = service.acquireLock({ path: 'src/shared.js', agentId: 'developer-2', mode: 'write' });
    const queuedRead = service.acquireLock({ path: 'src/shared.js', agentId: 'reviewer', mode: 'read' });
    assert.equal(queuedWrite.queued, true);
    assert.equal(queuedRead.queued, true);
    service.releaseLock(firstRead.lock.id);
    const state = service.getState();
    assert.equal(state.locks[0].agentId, 'developer-2');
    assert.equal(state.locks[0].mode, 'write');
    assert.equal(state.waiting[0].agentId, 'reviewer');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('promotes all consecutive readers together after a write lock releases', async () => {
  const { service, directory } = await fixture();
  try {
    const write = service.acquireLock({ path: 'src/parallel.js', agentId: 'developer-1', mode: 'write' });
    const readA = service.acquireLock({ path: 'src/parallel.js', agentId: 'developer-2', mode: 'read' });
    const readB = service.acquireLock({ path: 'src/parallel.js', agentId: 'reviewer', mode: 'read' });
    assert.equal(readA.queued, true);assert.equal(readB.queued, true);
    service.releaseLock(write.lock.id);
    assert.equal(service.getState().locks.length, 2);
    assert.ok(service.getState().locks.every(lock => lock.mode === 'read'));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});


test('agent memory proposals remain pending until user approval', async () => {
  const { service, directory } = await fixture();
  try {
    const proposal = await service.proposeMemory({ title: 'Build rules', content: 'Keep IPC narrow.', category: 'rules' }, 'developer-1');
    assert.equal(proposal.status, 'pending');
    assert.equal(service.getState().memory[0].status, 'pending');
    await service.approveMemory(proposal.id);
    assert.equal(service.getState().memory[0].status, 'approved');
    await assert.rejects(() => service.proposeMemory({ title: 'Bad', content: 'No', category: 'notes' }, 'unknown'), /enabled team agent/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('persists reordered panels and clamps custom panel widths', async () => {
  const { service, directory } = await fixture();
  try {
    const layout = await service.setLayout({ panels: ['graph', 'team', 'editor'], hidden: ['memory'], widths: { graph: 1200, team: 260, unknown: 500 } });
    assert.deepEqual(layout.panels, ['graph', 'team', 'editor']);
    assert.deepEqual(layout.hidden, ['memory']);
    assert.equal(layout.widths.graph, 900);
    assert.equal(layout.widths.team, 260);
    assert.equal(layout.widths.unknown, undefined);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('agents can retrieve task-scoped messages addressed to themselves or the team', async () => {
  const { service, directory } = await fixture();
  try {
    const task = await service.createTask({ title: 'Coordinate', description: 'Coordinate agents' });
    await service.sendMessage({ from: 'planner', to: 'developer-1', taskId: task.id, body: 'Inspect the API.' });
    await service.sendMessage({ from: 'developer-2', to: 'team', taskId: task.id, body: 'I found a dependency.' });
    const messages = service.getMessages('developer-1', task.id);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map(item => item.body), ['Inspect the API.', 'I found a dependency.']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('queued file lock requests can be cancelled without blocking later agents', async () => {
  const { service, directory } = await fixture();
  try {
    const held = service.acquireLock({ path: 'src/queue.js', agentId: 'developer-1', mode: 'write' });
    const waiting = service.acquireLock({ path: 'src/queue.js', agentId: 'developer-2', mode: 'write' });
    assert.equal(waiting.queued, true);
    assert.equal(service.cancelLockRequest(waiting.ticketId), true);
    service.releaseLock(held.lock.id);
    assert.equal(service.getState().locks.length, 0);
    assert.equal(service.getState().waiting.length, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});


test('saved team templates retain immutable numbered versions', async () => {
  const { service, directory } = await fixture();
  try {
    const first = await service.saveTemplate('Release team');
    await service.saveTeam({ ...service.getState().team, name: 'Updated team' });
    const second = await service.saveTemplate('Release team');
    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    assert.equal(first.groupId, second.groupId);
    assert.notEqual(first.id, second.id);
    assert.equal(service.getState().templates.length, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
