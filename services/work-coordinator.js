'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteFile } = require('./atomic-file');

const DEFAULT_AGENTS = [
  { id: 'planner', name: 'Planner', role: 'planner', provider: 'inherit', model: '', instructions: 'Coordinate the team, break work into tasks, and review decisions.', tools: ['read', 'plan', 'message', 'memory-propose'], enabled: true },
  { id: 'developer-1', name: 'Developer 1', role: 'developer', provider: 'inherit', model: '', instructions: 'Implement assigned development tasks within the agreed scope.', tools: ['read', 'write-proposal', 'message', 'memory-propose'], enabled: true },
  { id: 'developer-2', name: 'Developer 2', role: 'developer', provider: 'inherit', model: '', instructions: 'Work on independent assigned tasks and coordinate file ownership.', tools: ['read', 'write-proposal', 'message', 'memory-propose'], enabled: true },
  { id: 'reviewer', name: 'Reviewer', role: 'reviewer', provider: 'inherit', model: '', instructions: 'Review plans and proposed changes; identify risks and missing tests.', tools: ['read', 'review', 'message', 'memory-propose'], enabled: true }
];

function createWorkCoordinator({ app, workspace }) {
  const root = path.join(app.getPath('userData'), 'work-manager');
  const locks = new Map();
  const waiters = new Map();
  const tasks = new Map();
  const messages = [];
  const activity = [];
  let team = { id: 'default', name: 'Default development team', agents: DEFAULT_AGENTS.map(agent => ({ ...agent })), autonomy: 'hybrid', maxConcurrent: 3, maxStepsPerAgent: 8, agentTimeoutMinutes: 10, maxTokensPerAgent: 4096 };
  let teamTemplates = [];
  let memory = [];
  let layout = { panels: ['team', 'inspector', 'graph', 'tasks', 'timeline', 'memory', 'editor', 'browser'], hidden: [], widths: {} };

  function projectKey() {
    const folder = workspace.getInfo()?.path || 'unselected-workspace';
    return crypto.createHash('sha256').update(folder).digest('hex').slice(0, 24);
  }
  function statePath(name) { return path.join(root, projectKey(), `${name}.json`); }
  async function loadJson(name, fallback) {
    try { return JSON.parse(await fs.readFile(statePath(name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  async function saveJson(name, value) {
    const file = statePath(name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  }
  function record(type, detail = {}) {
    activity.unshift({ id: crypto.randomUUID(), type, at: Date.now(), ...detail });
    if (activity.length > 500) activity.length = 500;
  }
  function cleanText(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
  function publicState() {
    return {
      team: structuredClone(team), templates: structuredClone(teamTemplates), memory: structuredClone(memory),
      layout: structuredClone(layout), tasks: [...tasks.values()].map(task => ({ ...task })),
      locks: [...locks.values()].flatMap(held => held.map(lock => ({ ...lock }))), waiting: [...waiters.values()].flatMap(queue => queue.map(ticket => ({ ...ticket }))), messages: messages.slice(-200), activity: activity.slice(0, 200)
    };
  }
  async function load() {
    team = { id: 'default', name: 'Default development team', agents: DEFAULT_AGENTS.map(agent => ({ ...agent })), autonomy: 'hybrid', maxConcurrent: 3, maxStepsPerAgent: 8, agentTimeoutMinutes: 10, maxTokensPerAgent: 4096 };
    teamTemplates = []; memory = []; tasks.clear(); messages.length = 0; activity.length = 0; locks.clear(); waiters.clear();
    const savedTeam = await loadJson('team', null);
    if (savedTeam?.agents && Array.isArray(savedTeam.agents)) {
      team = { ...savedTeam, agents: savedTeam.agents.map(agent => {
        const builtIn = ['planner','developer-1','developer-2','reviewer'].includes(agent.id);
        return builtIn && Array.isArray(agent.tools) && !agent.tools.includes('memory-propose') ? { ...agent, tools: [...agent.tools, 'memory-propose'] } : agent;
      }), maxStepsPerAgent: Math.max(1, Math.min(40, Number(savedTeam.maxStepsPerAgent) || 8)), agentTimeoutMinutes: Math.max(1, Math.min(120, Number(savedTeam.agentTimeoutMinutes) || 10)), maxTokensPerAgent: Math.max(256, Math.min(16000, Number(savedTeam.maxTokensPerAgent) || 4096)) };
    }
    teamTemplates = await loadJson('teams', []);
    memory = await loadJson('memory', []);
    layout = await loadJson('layout', layout);
    for (const task of await loadJson('tasks', [])) if (task?.id) tasks.set(task.id, task);
    messages.push(...(await loadJson('messages', [])).slice(-500));
    record('workspace-loaded', { project: projectKey() });
    return publicState();
  }
  function validateAgent(agent) {
    if (!agent || typeof agent !== 'object') throw new Error('Invalid agent configuration.');
    const id = cleanText(agent.id, 64).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const name = cleanText(agent.name, 80);
    if (!id || !name) throw new Error('Every agent needs an ID and a name.');
    return { id, name, role: cleanText(agent.role, 40) || 'custom', provider: ['inherit','openrouter'].includes(cleanText(agent.provider, 60)) ? cleanText(agent.provider, 60) : 'inherit', model: cleanText(agent.model, 200), instructions: cleanText(agent.instructions, 8000), tools: Array.isArray(agent.tools) ? [...new Set(agent.tools.filter(x => typeof x === 'string').slice(0, 30))] : ['read', 'message'], enabled: agent.enabled !== false };
  }
  async function saveTeam(value) {
    if (!value || !Array.isArray(value.agents) || value.agents.length < 1 || value.agents.length > 16) throw new Error('A team must contain between 1 and 16 agents.');
    const agents = value.agents.map(validateAgent);
    if (new Set(agents.map(agent => agent.id)).size !== agents.length) throw new Error('Agent IDs must be unique.');
    team = { id: cleanText(value.id, 64) || crypto.randomUUID(), name: cleanText(value.name, 100) || 'Development team', agents, autonomy: ['planner-led', 'hybrid', 'user-approved'].includes(value.autonomy) ? value.autonomy : 'hybrid', maxConcurrent: Math.max(1, Math.min(8, Number(value.maxConcurrent) || 3)), maxStepsPerAgent: Math.max(1, Math.min(40, Number(value.maxStepsPerAgent) || 8)), agentTimeoutMinutes: Math.max(1, Math.min(120, Number(value.agentTimeoutMinutes) || 10)), maxTokensPerAgent: Math.max(256, Math.min(16000, Number(value.maxTokensPerAgent) || 4096)), updatedAt: Date.now() };
    await saveJson('team', team); record('team-updated', { name: team.name }); return structuredClone(team);
  }
  async function saveTemplate(name) {
    const templateName = cleanText(name, 100) || team.name;
    const previous = teamTemplates.filter(item => item.name.toLowerCase() === templateName.toLowerCase()).sort((a,b) => (b.version||1)-(a.version||1))[0];
    const template = { id: crypto.randomUUID(), groupId: previous?.groupId || previous?.id || crypto.randomUUID(), version: (previous?.version || 0) + 1, name: templateName, savedAt: Date.now(), team: structuredClone(team) };
    teamTemplates.unshift(template); teamTemplates = teamTemplates.slice(0, 50);
    await saveJson('teams', teamTemplates); record('team-saved', { name: template.name, version: template.version }); return template;
  }
  async function loadTemplate(id) {
    const template = teamTemplates.find(item => item.id === id);
    if (!template) throw new Error('Saved team not found.');
    return saveTeam(template.team);
  }
  async function addMemory(entry) {
    const item = { id: crypto.randomUUID(), title: cleanText(entry?.title, 120), content: cleanText(entry?.content, 5000), category: ['architecture','rules','design','decisions','restrictions','notes'].includes(entry?.category) ? entry.category : 'notes', pinned: !!entry?.pinned, status: 'approved', createdAt: Date.now(), updatedAt: Date.now() };
    if (!item.title || !item.content) throw new Error('Memory title and content are required.');
    memory.unshift(item); await saveJson('memory', memory); record('memory-added', { title: item.title }); return item;
  }
  async function proposeMemory(entry, agentId) {
    if (!team.agents.some(agent => agent.id === agentId && agent.enabled)) throw new Error('Only an enabled team agent can propose project memory.');
    const item = { id: crypto.randomUUID(), title: cleanText(entry?.title, 120), content: cleanText(entry?.content, 5000), category: ['architecture','rules','design','decisions','restrictions','notes'].includes(entry?.category) ? entry.category : 'notes', pinned: false, status: 'pending', proposedBy: agentId, createdAt: Date.now(), updatedAt: Date.now() };
    if (!item.title || !item.content) throw new Error('Memory title and content are required.');
    memory.unshift(item); await saveJson('memory', memory); record('memory-proposed', { title: item.title, agentId }); return item;
  }
  async function approveMemory(id) {
    const item = memory.find(entry => entry.id === id); if (!item) throw new Error('Memory proposal not found.');
    item.status = 'approved'; item.approvedAt = Date.now(); item.updatedAt = Date.now();
    await saveJson('memory', memory); record('memory-approved', { title: item.title, id }); return item;
  }
  async function updateMemory(id, patch) {
    const item = memory.find(entry => entry.id === id); if (!item) throw new Error('Memory entry not found.');
    if (patch.title !== undefined) item.title = cleanText(patch.title, 120);
    if (patch.content !== undefined) item.content = cleanText(patch.content, 5000);
    if (patch.category !== undefined) item.category = cleanText(patch.category, 40);
    if (patch.pinned !== undefined) item.pinned = !!patch.pinned;
    item.updatedAt = Date.now(); await saveJson('memory', memory); return item;
  }
  async function removeMemory(id) { memory = memory.filter(item => item.id !== id); await saveJson('memory', memory); record('memory-removed', { id }); return true; }
  async function setLayout(value) {
    const allowed = ['team','graph','inspector','timeline','tasks','editor','browser','memory'];
    const panels = Array.isArray(value?.panels) ? [...new Set(value.panels.filter(panel => allowed.includes(panel)))] : layout.panels;
    const hidden = Array.isArray(value?.hidden) ? [...new Set(value.hidden.filter(panel => allowed.includes(panel)))] : [];
    layout = { panels, hidden, widths: Object.fromEntries(Object.entries(value?.widths || {}).filter(([key, width]) => allowed.includes(key) && Number.isFinite(Number(width))).map(([key, width]) => [key, Math.max(180, Math.min(900, Number(width)))])) };
    await saveJson('layout', layout); return structuredClone(layout);
  }
  async function createTask(payload) {
    const task = { id: crypto.randomUUID(), title: cleanText(payload?.title, 160), description: cleanText(payload?.description, 8000), assignedTo: team.agents.some(agent => agent.id === payload?.assignedTo) ? payload.assignedTo : 'planner', status: 'queued', priority: ['low','normal','high'].includes(payload?.priority) ? payload.priority : 'normal', createdAt: Date.now(), updatedAt: Date.now() };
    if (!task.title || !task.description) throw new Error('Task title and instructions are required.');
    tasks.set(task.id, task); await saveJson('tasks', [...tasks.values()]); record('task-created', { taskId: task.id, title: task.title, agentId: task.assignedTo }); return { ...task };
  }
  async function updateTask(id, patch) {
    const task = tasks.get(id); if (!task) throw new Error('Task not found.');
    if (patch.status && ['queued','planning','in-progress','blocked','review','completed','cancelled','failed'].includes(patch.status)) task.status = patch.status;
    if (patch.assignedTo && team.agents.some(agent => agent.id === patch.assignedTo)) task.assignedTo = patch.assignedTo;
    if (patch.note) task.note = cleanText(patch.note, 2000);
    task.updatedAt = Date.now(); await saveJson('tasks', [...tasks.values()]); record('task-updated', { taskId: id, status: task.status, agentId: task.assignedTo }); return { ...task };
  }
  function getMessages(agentId, taskId = '') {
    const id = cleanText(agentId, 64), task = cleanText(taskId, 64);
    if (!team.agents.some(agent => agent.id === id)) throw new Error('Unknown agent.');
    return messages.filter(message => (!task || message.taskId === task) && (message.to === 'team' || message.to === id || message.from === id)).slice(-100);
  }
  async function sendMessage(payload) {
    const from = cleanText(payload?.from, 64), to = cleanText(payload?.to, 64), body = cleanText(payload?.body, 8000);
    if (!body) throw new Error('Message cannot be empty.');
    if (!team.agents.some(agent => agent.id === from) || (to !== 'team' && !team.agents.some(agent => agent.id === to))) throw new Error('Unknown agent in message.');
    const message = { id: crypto.randomUUID(), from, to, body, taskId: cleanText(payload?.taskId, 64), createdAt: Date.now() };
    messages.push(message); if (messages.length > 500) messages.shift(); await saveJson('messages', messages); record('agent-message', { from, to, taskId: message.taskId }); return message;
  }
  function acquireLock(payload) {
    const file = cleanText(payload?.path, 500).replace(/\\/g, '/');
    const agentId = cleanText(payload?.agentId, 64);
    if (!file || file.startsWith('/') || file.split('/').some(part => !part || part === '..')) throw new Error('Invalid workspace-relative file path.');
    if (!team.agents.some(agent => agent.id === agentId)) throw new Error('Unknown agent.');
    const mode = payload?.mode === 'write' ? 'write' : 'read';
    const existing = locks.get(file) || [];
    const queued = waiters.get(file) || [];
    if (mode === 'read' ? existing.some(lock => lock.mode === 'write') || queued.some(ticket => ticket.mode === 'write') : existing.length > 0 || queued.length > 0) {
      const queue = waiters.get(file) || []; const ticket = { id: crypto.randomUUID(), file, agentId, mode, requestedAt: Date.now() }; queue.push(ticket); waiters.set(file, queue); record('lock-waiting', { file, agentId, mode });
      return { acquired: false, queued: true, ticketId: ticket.id, holders: existing.map(lock => ({ agentId: lock.agentId, mode: lock.mode })) };
    }
    const lock = { id: crypto.randomUUID(), file, agentId, mode, acquiredAt: Date.now(), expiresAt: Date.now() + 120000 };
    locks.set(file, [...existing, lock]); record('lock-acquired', { file, agentId, mode }); return { acquired: true, lock };
  }
  function cancelLockRequest(ticketId) {
    for (const [file, queue] of waiters) {
      const next = queue.filter(ticket => ticket.id !== ticketId);
      if (next.length !== queue.length) { if (next.length) waiters.set(file, next); else waiters.delete(file); record('lock-request-cancelled', { file, ticketId }); return true; }
    }
    return false;
  }
  function releaseLock(id) {
    for (const [file, held] of locks) {
      const next = held.filter(lock => lock.id !== id);
      if (next.length !== held.length) { if (next.length) locks.set(file, next); else locks.delete(file); record('lock-released', { file, lockId: id }); promote(file); return true; }
    }
    return false;
  }
  function promote(file) {
    const queue = waiters.get(file) || []; if (!queue.length || locks.has(file)) return;
    const promoted = [];
    if (queue[0].mode === 'write') promoted.push(queue.shift());
    else while (queue.length && queue[0].mode === 'read') promoted.push(queue.shift());
    waiters.set(file, queue);
    const granted = promoted.map(item => ({ id: crypto.randomUUID(), file, agentId: item.agentId, mode: item.mode, acquiredAt: Date.now(), expiresAt: Date.now() + 120000 }));
    locks.set(file, granted); record('lock-promoted', { file, agents: granted.map(item => item.agentId) });
  }
  function renewLock(id) {
    for (const held of locks.values()) { const lock = held.find(item => item.id === id); if (lock) { lock.expiresAt = Date.now() + 120000; return { ...lock }; } }
    throw new Error('Lock is no longer active.');
  }
  function cleanupLocks() {
    for (const [file, held] of locks) { const next = held.filter(lock => lock.expiresAt > Date.now()); if (next.length !== held.length) { if (next.length) locks.set(file, next); else locks.delete(file); promote(file); } }
  }
  return { load, getState: () => { cleanupLocks(); return publicState(); }, saveTeam, saveTemplate, loadTemplate, addMemory, proposeMemory, approveMemory, updateMemory, removeMemory, setLayout, createTask, updateTask, sendMessage, getMessages, acquireLock, cancelLockRequest, releaseLock, renewLock };
}

module.exports = { createWorkCoordinator, DEFAULT_AGENTS };
