'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAgentEventStore } = require('../services/agent-event-store');

test('agent event store persists, filters and bounds activity', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'lair-events-'));
  try {
    const store = createAgentEventStore({ fs, path, userData });
    await store.load();
    await store.append({ type: 'tool', agentId: 'developer-1', summary: 'Read source', detail: 'renderer.js', project: '/workspace/alpha' });
    await store.append({ type: 'tool', agentId: 'developer-2', summary: 'Other project', project: '/workspace/beta' });
    await store.append({ type: 'message', agentId: 'planner', summary: 'Delegated task' });
    assert.equal(store.list({ agentId: 'planner' }).length, 1);
    const reopened = createAgentEventStore({ fs, path, userData });
    await reopened.load();
    assert.equal(reopened.list().length, 3);
    assert.equal(reopened.list({ project: '/workspace/alpha' }).length, 1);
    assert.equal(reopened.list({ type: 'tool' })[0].summary, 'Read source');
  } finally { await fs.rm(userData, { recursive: true, force: true }); }
});
