'use strict';

const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteFile } = require('./atomic-file');

const MAX_READ_BYTES = 1_500_000;
const MAX_WRITE_BYTES = 1_000_000;
const MAX_BACKUPS = 300;
const TEXT_EXTENSIONS = new Set(['.txt','.md','.markdown','.csv','.json','.xml','.html','.htm','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.java','.cs','.yaml','.yml','.log','.sql','.sh','.ps1','.toml','.ini','.cfg','.go','.rs','.c','.h','.cpp','.hpp','.rb','.php','.swift','.kt']);

function createWorkspaceService({ dialog, app }) {
  let workspaceRoot = null;
  const userData = app.getPath('userData');
  const backupRoot = path.join(userData, 'workspace-backups');
  const configPath = path.join(userData, 'workspace.json');
  const backupIndexPath = path.join(backupRoot, 'index.json');

  async function load() {
    try {
      const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
      if (saved && typeof saved.path === 'string') {
        const candidate = await fs.realpath(saved.path);
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) workspaceRoot = candidate;
      }
    } catch (_) { workspaceRoot = null; }
    return workspaceRoot ? { path: workspaceRoot, name: path.basename(workspaceRoot) } : null;
  }

  async function setFolder(directory) {
    if (typeof directory !== 'string' || !directory.trim() || directory.length > 4096) throw new Error('Choose a valid project folder.');
    const candidate = await fs.realpath(directory);
    const stat = await fs.stat(candidate);
    if (!stat.isDirectory()) throw new Error('The selected project path is not a folder.');
    workspaceRoot = candidate;
    await fs.mkdir(userData, { recursive: true });
    await atomicWriteFile(configPath, JSON.stringify({ path: workspaceRoot }), { mode: 0o600 });
    return { path: workspaceRoot, name: path.basename(workspaceRoot) };
  }

  async function choose(owner, title = 'Choose a folder for AI work') {
    const result = await dialog.showOpenDialog(owner, { title, properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return setFolder(result.filePaths[0]);
  }

  async function importFiles(owner) {
    requireRoot();
    const extensions = [...TEXT_EXTENSIONS].map(extension => extension.slice(1));
    const result = await dialog.showOpenDialog(owner, {
      title: 'Import source files into the selected project folder',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Source and text files', extensions }]
    });
    if (result.canceled || !result.filePaths?.length) return { imported: [], skipped: [], cancelled: true };
    if (result.filePaths.length > 50) throw new Error('Import up to 50 files at a time.');
    const imported = [], skipped = [];
    for (const sourcePath of result.filePaths) {
      try {
        const sourceStat = await fs.lstat(sourcePath);
        if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error('Only regular files can be imported.');
        if (!TEXT_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) throw new Error('This editor imports supported text and source-code files only.');
        if (sourceStat.size > MAX_READ_BYTES) throw new Error('The file exceeds the 1.5 MB editor import limit.');
        const originalName = path.basename(sourcePath);
        if (!originalName || originalName === '.' || originalName === '..') throw new Error('The selected file name is not valid.');
        const sourceRealPath = await fs.realpath(sourcePath);
        const parsed = path.parse(originalName);
        let relativePath = originalName;
        let destination = await resolveInside(relativePath);
        if (sourceRealPath === destination) throw new Error('This file is already inside the selected workspace.');
        let suffix = 2;
        while (await fs.lstat(destination).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
          relativePath = parsed.name + ' (imported ' + suffix + ')' + parsed.ext;
          destination = await resolveInside(relativePath);
          suffix++;
          if (suffix > 100) throw new Error('Could not find an unused name for this imported file.');
        }
        await fs.copyFile(sourceRealPath, destination, fsConstants.COPYFILE_EXCL);
        imported.push({ name: path.basename(relativePath), path: relativePath, bytes: sourceStat.size });
      } catch (error) {
        skipped.push({ name: path.basename(sourcePath), reason: String(error.message || error).slice(0, 180) });
      }
    }
    return { imported, skipped, cancelled: false };
  }

  function requireRoot() {
    if (!workspaceRoot) throw new Error('Choose a workspace folder first.');
    return workspaceRoot;
  }

  async function resolveInside(relativePath) {
    const root = requireRoot();
    const clean = String(relativePath || '').replace(/\\/g, '/');
    if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').some(part => part === '..' || part === '')) {
      throw new Error('The requested path is not valid inside the selected workspace.');
    }
    const candidate = path.resolve(root, clean);
    const rel = path.relative(root, candidate);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Workspace root access is not permitted.');
    const parent = await fs.realpath(path.dirname(candidate)).catch(() => path.dirname(candidate));
    const parentRel = path.relative(root, parent);
    if (parentRel.startsWith('..') || path.isAbsolute(parentRel)) throw new Error('The path resolves outside the selected workspace.');
    const entry = await fs.lstat(candidate).catch(() => null);
    if (entry?.isSymbolicLink()) throw new Error('Symbolic links are not supported in the selected workspace.');
    return candidate;
  }

  async function readBackupIndex() {
    try {
      const data = JSON.parse(await fs.readFile(backupIndexPath, 'utf8'));
      return Array.isArray(data) ? data.filter(item => item && /^[a-f0-9-]{36}$/i.test(item.id) && typeof item.fileName === 'string' && typeof item.relativePath === 'string').slice(0, MAX_BACKUPS) : [];
    } catch (_) { return []; }
  }

  async function writeBackupIndex(entries) {
    await fs.mkdir(backupRoot, { recursive: true });
    await atomicWriteFile(backupIndexPath, JSON.stringify(entries.slice(0, MAX_BACKUPS), null, 2), { mode: 0o600 });
  }

  async function createBackup(filePath, relativePath, existingStat) {
    const id = crypto.randomUUID();
    const fileName = `${Date.now()}-${id}.bak`;
    const destination = path.join(backupRoot, fileName);
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.copyFile(filePath, destination, fs.constants.COPYFILE_EXCL);
    const entries = await readBackupIndex();
    const record = { id, fileName, relativePath: String(relativePath), createdAt: Date.now(), size: existingStat.size };
    entries.unshift(record);
    const removed = entries.splice(MAX_BACKUPS);
    await writeBackupIndex(entries);
    for (const old of removed) await fs.unlink(path.join(backupRoot, path.basename(old.fileName))).catch(() => {});
    return record;
  }

  function makeDiffPreview(before, after) {
    const oldLines = String(before || '').split(/\r?\n/);
    const newLines = String(after || '').split(/\r?\n/);
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
    let suffix = 0;
    while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
    const removed = oldLines.slice(prefix, oldLines.length - suffix);
    const added = newLines.slice(prefix, newLines.length - suffix);
    const lines = [`@@ change near line ${prefix + 1} @@`, ...removed.slice(0, 30).map(line => `- ${line}`), ...added.slice(0, 30).map(line => `+ ${line}`)];
    if (removed.length > 30 || added.length > 30) lines.push('[Diff preview truncated; only the first 30 changed lines of each side are shown.]');
    return lines.join('\n').slice(0, 8500);
  }

  async function previewWrite(relativePath, content) {
    const filePath = await resolveInside(relativePath);
    if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('This workspace writer only supports text and source files.');
    const value = String(content ?? '');
    if (Buffer.byteLength(value, 'utf8') > MAX_WRITE_BYTES) throw new Error('New file content exceeds the 1 MB limit.');
    const existing = await fs.lstat(filePath).catch(() => null);
    if (existing && (existing.isSymbolicLink() || !existing.isFile() || existing.size > MAX_READ_BYTES)) throw new Error('Existing file cannot be safely backed up.');
    const before = existing ? await fs.readFile(filePath, 'utf8') : '';
    return { path: String(relativePath), exists: Boolean(existing), oldBytes: existing?.size || 0, oldHash: crypto.createHash('sha256').update(before).digest('hex'), newBytes: Buffer.byteLength(value, 'utf8'), diff: makeDiffPreview(before, value) };
  }

  async function list(relativePath = '') {
    const root = requireRoot();
    const directory = relativePath ? await resolveInside(relativePath) : root;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return Promise.all(entries.slice(0, 500).map(async entry => {
      const full = path.join(directory, entry.name);
      const stat = await fs.lstat(full);
      return {
        name: entry.name,
        path: path.relative(root, full).replace(/\\/g, '/'),
        type: entry.isSymbolicLink() ? 'link (not accessible)' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'unsupported',
        size: entry.isFile() ? stat.size : null
      };
    }));
  }

  async function read(relativePath) {
    const filePath = await resolveInside(relativePath);
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) throw new Error('This workspace reader only opens supported text and source files.');
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_READ_BYTES) throw new Error('File is not readable or exceeds the 1.5 MB limit.');
    return (await fs.readFile(filePath, 'utf8')).replace(/\u0000/g, '');
  }

  async function search(query, relativePath = '') {
    const term = String(query || '').trim().toLowerCase();
    if (term.length < 2) throw new Error('Use at least two characters to search.');
    const root = requireRoot();
    const start = relativePath ? await resolveInside(relativePath) : root;
    const results = [];
    let visited = 0;
    async function walk(directory) {
      if (visited >= 3000 || results.length >= 40) return;
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        if (visited >= 3000 || results.length >= 40) break;
        if (entry.name.startsWith('.') || ['node_modules','vendor','dist','build','.git'].includes(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          visited++;
          try {
            const stat = await fs.stat(full);
            if (stat.size > 300_000) continue;
            const content = await fs.readFile(full, 'utf8');
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(term)) {
                results.push({ path: path.relative(root, full).replace(/\\/g, '/'), line: i + 1, excerpt: lines[i].trim().slice(0, 240) });
                if (results.length >= 40) break;
              }
            }
          } catch (_) { /* skip unreadable file */ }
        }
      }
    }
    await walk(start);
    return { results, filesVisited: visited, capped: visited >= 3000 };
  }

  async function previewCreate(relativePath, content) {
    const filePath = await resolveInside(relativePath);
    if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('This workspace writer only supports text and source files.');
    const value = String(content ?? '');
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_WRITE_BYTES) throw new Error('New file content exceeds the 1 MB limit.');
    const existing = await fs.lstat(filePath).catch(() => null);
    if (existing) throw new Error('A file already exists at this path. Use edit_workspace_file only when the user asked to modify that file.');
    return {
      path: String(relativePath),
      bytes,
      preview: value.split(/\r?\n/).slice(0, 24).join('\n').slice(0, 2200)
    };
  }

  async function create(relativePath, content) {
    const preview = await previewCreate(relativePath, content);
    const filePath = await resolveInside(relativePath);
    let handle;
    let createdByThisCall = false;
    try {
      // wx is important: a concurrent run cannot silently replace a file after preview.
      handle = await fs.open(filePath, 'wx');
      createdByThisCall = true;
      await handle.writeFile(String(content ?? ''), 'utf8');
      await handle.sync();
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (createdByThisCall) await fs.unlink(filePath).catch(() => {});
      if (error && error.code === 'EEXIST') throw new Error('A file already exists at this path. No existing content was changed.');
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
    return { path: preview.path, bytes: preview.bytes, created: true, backupCreated: false };
  }

  async function write(relativePath, content) {
    const filePath = await resolveInside(relativePath);
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) throw new Error('This workspace writer only supports text and source files.');
    const value = String(content ?? '');
    if (Buffer.byteLength(value, 'utf8') > MAX_WRITE_BYTES) throw new Error('New file content exceeds the 1 MB limit.');
    const existing = await fs.lstat(filePath).catch(() => null);
    if (existing && (existing.isSymbolicLink() || !existing.isFile() || existing.size > MAX_READ_BYTES)) throw new Error('Existing file cannot be safely backed up.');
    let backup = null;
    if (existing) backup = await createBackup(filePath, relativePath, existing);
    const fileMode = existing ? (existing.mode & 0o777) : 0o600;
    await atomicWriteFile(filePath, value, { mode: fileMode });
    return { path: relativePath, bytes: Buffer.byteLength(value, 'utf8'), backupCreated: Boolean(backup), backupId: backup?.id || null };
  }

  async function backups() {
    requireRoot();
    const entries = await readBackupIndex();
    return entries.map(({ id, relativePath, createdAt, size }) => ({ id, relativePath, createdAt, size }));
  }

  async function restoreBackup(id) {
    requireRoot();
    const entries = await readBackupIndex();
    const entry = entries.find(item => item.id === String(id));
    if (!entry) throw new Error('Backup not found. It may have been removed.');
    if (!/^\d+-[a-f0-9-]{36}\.bak$/i.test(entry.fileName) || !entry.fileName.endsWith(`${entry.id}.bak`)) throw new Error('Backup metadata is invalid.');
    const backupPath = path.join(backupRoot, entry.fileName);
    const backupStat = await fs.lstat(backupPath);
    if (backupStat.isSymbolicLink() || !backupStat.isFile() || backupStat.size > MAX_READ_BYTES) throw new Error('Backup is not a supported regular file.');
    const filePath = await resolveInside(entry.relativePath);
    if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('This backup cannot be restored to an unsupported file type.');
    const existing = await fs.lstat(filePath).catch(() => null);
    if (existing && (existing.isSymbolicLink() || !existing.isFile() || existing.size > MAX_READ_BYTES)) throw new Error('Current file cannot be safely backed up.');
    let safetyBackup = null;
    if (existing) safetyBackup = await createBackup(filePath, entry.relativePath, existing);
    const content = await fs.readFile(backupPath);
    const fileMode = existing ? (existing.mode & 0o777) : 0o600;
    await atomicWriteFile(filePath, content, { mode: fileMode });
    return { path: entry.relativePath, bytes: content.length, safetyBackupId: safetyBackup?.id || null };
  }

  return {
    choose,
    setFolder,
    importFiles,
    load,
    getInfo: () => workspaceRoot ? { path: workspaceRoot, name: path.basename(workspaceRoot) } : null,
    list, read, search, create, previewCreate, write, previewWrite, backups, restoreBackup,
    clear: async () => { workspaceRoot = null; await fs.unlink(configPath).catch(() => {}); }
  };
}

module.exports = { createWorkspaceService };
