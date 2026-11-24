'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSandboxService } = require('../services/sandbox-service');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lair-sandbox-'));
  const source = path.join(root, 'source-project');
  const data = path.join(root, 'app-data');
  await fs.mkdir(path.join(source, 'src'), { recursive: true });
  await fs.writeFile(path.join(source, 'README.md'), '# Original\n', 'utf8');
  await fs.writeFile(path.join(source, 'src', 'index.js'), 'module.exports = 1;\n', 'utf8');
  const service = createSandboxService({ baseDir: data });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, source, data, service };
}

test('sandbox edits remain isolated until explicit sync', async t => {
  const { source, service } = await fixture(t);
  const project = await service.importFolder(source);
  await service.writeFile(project.id, 'README.md', '# Updated in sandbox\n');
  await service.writeFile(project.id, 'src/new.js', 'export const value = 2;\n');

  assert.equal(await fs.readFile(path.join(source, 'README.md'), 'utf8'), '# Original\n');
  await assert.rejects(fs.readFile(path.join(source, 'src', 'new.js'), 'utf8'), { code: 'ENOENT' });

  const pending = await service.changes(project.id);
  assert.deepEqual(pending.added, ['src/new.js']);
  assert.deepEqual(pending.modified, ['README.md']);
  const synced = await service.sync(project.id);
  assert.deepEqual(synced.written.sort(), ['README.md', 'src/new.js']);
  assert.equal(await fs.readFile(path.join(source, 'README.md'), 'utf8'), '# Updated in sandbox\n');
  assert.equal(await fs.readFile(path.join(source, 'src', 'new.js'), 'utf8'), 'export const value = 2;\n');
  assert.ok(synced.backupFolder);
});

test('sync skips conflicting original-file edits unless overwrite is explicitly requested', async t => {
  const { source, service } = await fixture(t);
  const project = await service.importFolder(source);
  await service.writeFile(project.id, 'README.md', '# Sandbox version\n');
  await fs.writeFile(path.join(source, 'README.md'), '# Changed outside the app\n', 'utf8');

  const report = await service.changes(project.id);
  assert.deepEqual(report.conflicts, ['README.md']);
  const synced = await service.sync(project.id);
  assert.equal(synced.written.length, 0);
  assert.equal(synced.skipped.length, 1);
  assert.equal(await fs.readFile(path.join(source, 'README.md'), 'utf8'), '# Changed outside the app\n');
});

test('project paths cannot escape the sandbox', async t => {
  const { source, service } = await fixture(t);
  const project = await service.importFolder(source);
  await assert.rejects(service.writeFile(project.id, '../escape.txt', 'nope'), /Paths cannot go above/);
});
