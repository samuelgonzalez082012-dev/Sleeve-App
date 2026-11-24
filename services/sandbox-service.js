'use strict';

/**
 * Project sandbox: a private, app-side copy of a project folder.
 *
 * - Opening a folder copies its text files into the app's own storage. The user and the AI edit that copy only.
 * - The original folder is never touched until the user presses "Sync files", which writes a reviewed list of
 *   changes back (with backups of anything it overwrites or deletes).
 * - Every path that comes from the renderer or the AI is a relative, validated path that cannot leave its root.
 */

const fs = require('node:fs/promises');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteFile } = require('./atomic-file');

const IGNORED_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', '.next', '.nuxt', '.cache', '.gradle', '.pytest_cache', '.mypy_cache', '.idea', '.vs', 'out', 'dist', 'build', 'coverage', 'target']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif', '.psd', '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.mov', '.avi', '.mkv', '.webm', '.zip', '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.class', '.jar', '.pyc', '.o', '.obj', '.blend', '.fbx', '.glb', '.sqlite', '.db']);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 80_000_000;
const MAX_DEPTH = 24;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const ID_PATTERN = /^[a-f0-9]{16}$/;

const sha1 = buffer => crypto.createHash('sha1').update(buffer).digest('hex');
const looksBinary = buffer => buffer.subarray(0, 8000).includes(0);

/** Validate and normalise a project-relative path. Always returns forward-slash form without a leading slash. */
function cleanRel(input, { allowEmpty = false } = {}) {
  const raw = String(input == null ? '' : input).replace(/\\/g, '/').replace(/^\/+/, '');
  if (raw.includes('\0')) throw new Error('That path is not valid.');
  const parts = raw.split('/').filter(part => part && part !== '.');
  if (!parts.length) {
    if (allowEmpty) return '';
    throw new Error('A file path is required.');
  }
  if (raw.length > 400 || parts.length > MAX_DEPTH) throw new Error('That path is too long.');
  for (const part of parts) {
    if (part === '..') throw new Error('Paths cannot go above the project folder.');
    if (/[<>:"|?*\u0000-\u001f]/.test(part) || /[ .]$/.test(part) || RESERVED_NAMES.test(part)) throw new Error(`“${part}” is not a valid file or folder name.`);
    if (part.length > 200) throw new Error('A name in that path is too long.');
  }
  if (parts[0].toLowerCase() === '.git') throw new Error('The .git folder is not part of the sandbox.');
  return parts.join('/');
}

function resolveInside(root, rel) {
  const absolute = nodePath.resolve(root, ...(rel ? rel.split('/') : []));
  if (absolute !== root && !absolute.startsWith(root + nodePath.sep)) throw new Error('Paths cannot go above the project folder.');
  return absolute;
}

async function exists(target) { try { await fs.lstat(target); return true; } catch (_) { return false; } }

/** Walk a directory, yielding relative file entries and counting what was skipped. */
async function walk(root, skipped, { limitFiles = MAX_FILES } = {}) {
  const files = [];
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop();
    let entries;
    try { entries = await fs.readdir(resolveInside(root, relDir), { withFileTypes: true }); } catch (_) { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { skipped.symlinks++; continue; }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name === '.git') { skipped.ignoredFolders++; continue; }
        if (rel.split('/').length >= MAX_DEPTH) { skipped.tooDeep++; continue; }
        stack.push(rel);
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) continue;
        if (BINARY_EXTENSIONS.has(nodePath.extname(entry.name).toLowerCase())) { skipped.binary++; continue; }
        try { cleanRel(rel); } catch (_) { skipped.badNames++; continue; }
        if (files.length >= limitFiles) { skipped.overLimit++; continue; }
        files.push(rel);
      }
    }
  }
  files.sort();
  return files;
}

const emptySkipped = () => ({ ignoredFolders: 0, binary: 0, large: 0, symlinks: 0, overLimit: 0, tooDeep: 0, badNames: 0 });

function createSandboxService({ baseDir, onChange = () => {} }) {
  if (!baseDir) throw new Error('baseDir is required.');
  const base = nodePath.resolve(baseDir);

  const dirFor = id => {
    if (!ID_PATTERN.test(String(id || ''))) throw new Error('Unknown project.');
    return nodePath.join(base, id);
  };
  const filesRoot = id => nodePath.join(dirFor(id), 'files');
  const metaPath = id => nodePath.join(dirFor(id), 'meta.json');

  async function loadMeta(id) {
    try { return JSON.parse(await fs.readFile(metaPath(id), 'utf8')); }
    catch (_) { throw new Error('That project is not available any more.'); }
  }
  const saveMeta = (id, meta) => atomicWriteFile(metaPath(id), JSON.stringify(meta));
  const summary = meta => ({ id: meta.id, name: meta.name, source: meta.source, createdAt: meta.createdAt, syncedAt: meta.syncedAt || null, fileCount: Object.keys(meta.baseline || {}).length });

  async function readText(absolute, limit = MAX_FILE_BYTES) {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error('That is not a file.');
    if (stat.size > limit) throw new Error(`That file is larger than ${Math.round(limit / 1000)} KB.`);
    const buffer = await fs.readFile(absolute);
    if (looksBinary(buffer)) throw new Error('That file looks like a binary file, which the sandbox cannot show.');
    return buffer;
  }

  /* ---------- opening and listing ---------- */
  async function listSandboxes() {
    let names = [];
    try { names = await fs.readdir(base); } catch (_) { return []; }
    const out = [];
    for (const name of names) {
      if (!ID_PATTERN.test(name)) continue;
      try { out.push(summary(await loadMeta(name))); } catch (_) { /* skip broken */ }
    }
    return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function importFolder(sourceDir) {
    const source = nodePath.resolve(String(sourceDir || ''));
    if (nodePath.parse(source).root === source) throw new Error('Choose a project folder, not a whole drive.');
    const stat = await fs.stat(source).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new Error('That folder could not be opened.');
    const existing = (await listSandboxes()).find(item => nodePath.resolve(item.source) === source);
    if (existing) return { ...existing, existing: true, skipped: emptySkipped() };

    const skipped = emptySkipped();
    const candidates = await walk(source, skipped);
    const id = crypto.randomBytes(8).toString('hex');
    const root = filesRoot(id);
    await fs.mkdir(root, { recursive: true });
    const baseline = {};
    let total = 0;
    for (const rel of candidates) {
      const from = resolveInside(source, rel);
      let buffer;
      try {
        const info = await fs.lstat(from);
        if (!info.isFile()) continue;
        if (info.size > MAX_FILE_BYTES) { skipped.large++; continue; }
        if (total + info.size > MAX_TOTAL_BYTES) { skipped.overLimit++; continue; }
        buffer = await fs.readFile(from);
      } catch (_) { continue; }
      if (looksBinary(buffer)) { skipped.binary++; continue; }
      const to = resolveInside(root, rel);
      await fs.mkdir(nodePath.dirname(to), { recursive: true });
      await fs.writeFile(to, buffer);
      baseline[rel] = { h: sha1(buffer), s: buffer.length };
      total += buffer.length;
    }
    const meta = { id, name: nodePath.basename(source) || 'Project', source, createdAt: Date.now(), syncedAt: null, baseline };
    await saveMeta(id, meta);
    return { ...summary(meta), existing: false, skipped, totalBytes: total };
  }

  async function removeSandbox(id) {
    const dir = dirFor(id);
    await loadMeta(id);
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }

  async function get(id) { return summary(await loadMeta(id)); }

  /* ---------- reading ---------- */
  async function localFiles(id) {
    const root = filesRoot(id);
    const out = [];
    const stack = [''];
    while (stack.length) {
      const relDir = stack.pop();
      let entries = [];
      try { entries = await fs.readdir(resolveInside(root, relDir), { withFileTypes: true }); } catch (_) { continue; }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { out.push({ path: rel, type: 'dir', size: 0 }); stack.push(rel); }
        else if (entry.isFile()) {
          let size = 0;
          try { size = (await fs.stat(resolveInside(root, rel))).size; } catch (_) { /* ignore */ }
          out.push({ path: rel, type: 'file', size });
        }
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async function tree(id) {
    const meta = await loadMeta(id);
    const entries = await localFiles(id);
    const root = filesRoot(id);
    const changed = await changeSet(id, meta, root, entries);
    const status = new Map();
    changed.added.forEach(p => status.set(p, 'A'));
    changed.modified.forEach(p => status.set(p, 'M'));
    return {
      project: summary(meta),
      entries: entries.slice(0, 8000).map(entry => ({ ...entry, status: status.get(entry.path) || '' })),
      deleted: changed.deleted,
      truncated: entries.length > 8000
    };
  }

  async function readFile(id, rel) {
    const clean = cleanRel(rel);
    const buffer = await readText(resolveInside(filesRoot(id), clean));
    return { path: clean, content: buffer.toString('utf8'), size: buffer.length };
  }

  /* ---------- writing (sandbox only) ---------- */
  async function writeFile(id, rel, content) {
    const clean = cleanRel(rel);
    const text = String(content == null ? '' : content);
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error(`Files in the sandbox are limited to ${Math.round(MAX_FILE_BYTES / 1000)} KB.`);
    await loadMeta(id);
    const absolute = resolveInside(filesRoot(id), clean);
    const info = await fs.lstat(absolute).catch(() => null);
    if (info && info.isDirectory()) throw new Error('That path is a folder.');
    if (info && info.isSymbolicLink()) throw new Error('That path is not a regular file.');
    await fs.mkdir(nodePath.dirname(absolute), { recursive: true });
    await atomicWriteFile(absolute, text, { mode: 0o644 });
    onChange(id, [clean]);
    return { path: clean, created: !info, size: Buffer.byteLength(text) };
  }

  async function makeDir(id, rel) {
    const clean = cleanRel(rel);
    await loadMeta(id);
    await fs.mkdir(resolveInside(filesRoot(id), clean), { recursive: true });
    onChange(id, [clean]);
    return { path: clean };
  }

  async function deleteEntry(id, rel) {
    const clean = cleanRel(rel);
    await loadMeta(id);
    const absolute = resolveInside(filesRoot(id), clean);
    if (!(await exists(absolute))) throw new Error('That file or folder does not exist.');
    await fs.rm(absolute, { recursive: true, force: true });
    onChange(id, [clean]);
    return { path: clean };
  }

  async function renameEntry(id, from, to) {
    const a = cleanRel(from); const b = cleanRel(to);
    if (a === b) return { from: a, to: b };
    if (b.startsWith(`${a}/`)) throw new Error('A folder cannot be moved into itself.');
    await loadMeta(id);
    const root = filesRoot(id);
    const source = resolveInside(root, a); const target = resolveInside(root, b);
    if (!(await exists(source))) throw new Error('That file or folder does not exist.');
    if (await exists(target)) throw new Error(`“${b}” already exists.`);
    await fs.mkdir(nodePath.dirname(target), { recursive: true });
    await fs.rename(source, target);
    onChange(id, [a, b]);
    return { from: a, to: b };
  }

  async function editFile(id, rel, oldText, newText, replaceAll = false) {
    const current = await readFile(id, rel);
    const needle = String(oldText == null ? '' : oldText);
    if (!needle) throw new Error('old is required: the exact text to replace.');
    const count = current.content.split(needle).length - 1;
    if (count === 0) throw new Error('The text to replace was not found. Read the file again and copy the exact text.');
    if (count > 1 && !replaceAll) throw new Error(`The text appears ${count} times. Include more surrounding text so it is unique, or set replace_all.`);
    const next = replaceAll ? current.content.split(needle).join(String(newText == null ? '' : newText)) : current.content.replace(needle, () => String(newText == null ? '' : newText));
    await writeFile(id, rel, next);
    return { path: current.path, replacements: replaceAll ? count : 1 };
  }

  async function search(id, query, { regex = false, rel = '', limit = 60 } = {}) {
    const text = String(query || '');
    if (!text) throw new Error('A search query is required.');
    if (text.length > 200) throw new Error('The search text is too long.');
    let matcher;
    if (regex) { try { const re = new RegExp(text, 'i'); matcher = line => re.test(line); } catch (error) { throw new Error(`Invalid regular expression: ${error.message}`); } }
    else { const lower = text.toLowerCase(); matcher = line => line.toLowerCase().includes(lower); }
    const prefix = cleanRel(rel, { allowEmpty: true });
    const root = filesRoot(id);
    const hits = [];
    const entries = (await localFiles(id)).filter(entry => entry.type === 'file' && (!prefix || entry.path === prefix || entry.path.startsWith(`${prefix}/`)));
    let scanned = 0;
    for (const entry of entries) {
      if (hits.length >= limit) break;
      let buffer;
      try { buffer = await readText(resolveInside(root, entry.path)); } catch (_) { continue; }
      scanned++;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < limit; i++) {
        const line = lines[i].length > 500 ? lines[i].slice(0, 500) : lines[i];
        if (matcher(line)) hits.push({ path: entry.path, line: i + 1, text: line.trim().slice(0, 200) });
      }
    }
    return { hits, scanned, truncated: hits.length >= limit };
  }

  /* ---------- comparing with the original folder ---------- */
  async function changeSet(id, meta, root, entries) {
    const baseline = meta.baseline || {};
    const files = (entries || await localFiles(id)).filter(entry => entry.type === 'file');
    const added = []; const modified = []; const present = new Set();
    for (const entry of files) {
      present.add(entry.path);
      const known = baseline[entry.path];
      if (!known) { added.push(entry.path); continue; }
      if (known.s !== entry.size) { modified.push(entry.path); continue; }
      try {
        const buffer = await fs.readFile(resolveInside(root, entry.path));
        if (sha1(buffer) !== known.h) modified.push(entry.path);
      } catch (_) { /* unreadable: treat as unchanged */ }
    }
    const deleted = Object.keys(baseline).filter(rel => !present.has(rel)).sort();
    return { added, modified, deleted };
  }

  async function realHash(source, rel) {
    try {
      const absolute = resolveInside(source, rel);
      const info = await fs.lstat(absolute);
      if (!info.isFile()) return { state: 'other' };
      if (info.size > MAX_FILE_BYTES * 4) return { state: 'large' };
      return { state: 'file', hash: sha1(await fs.readFile(absolute)) };
    } catch (_) { return { state: 'missing' }; }
  }

  async function changes(id) {
    const meta = await loadMeta(id);
    const sourceOk = !!(await fs.stat(meta.source).catch(() => null));
    const set = await changeSet(id, meta, filesRoot(id));
    const conflicts = [];
    if (sourceOk) {
      for (const rel of [...set.modified, ...set.deleted]) {
        const real = await realHash(meta.source, rel);
        const base = meta.baseline[rel];
        if (real.state === 'file' && base && real.hash !== base.h) conflicts.push(rel);
        else if (real.state === 'missing' && set.modified.includes(rel)) conflicts.push(rel);
      }
      for (const rel of set.added) {
        const real = await realHash(meta.source, rel);
        if (real.state === 'file' || real.state === 'other') conflicts.push(rel);
      }
    }
    return { project: summary(meta), sourceOk, ...set, conflicts: [...new Set(conflicts)].sort() };
  }

  async function backupReal(id, meta, stamp, rel) {
    const from = resolveInside(meta.source, rel);
    if (!(await exists(from))) return null;
    const to = resolveInside(nodePath.join(dirFor(id), 'backups', stamp), rel);
    await fs.mkdir(nodePath.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    return to;
  }

  async function assertRealParentInside(source, rel) {
    const realRoot = await fs.realpath(source);
    let probe = nodePath.dirname(resolveInside(source, rel));
    while (!(await exists(probe))) probe = nodePath.dirname(probe);
    const realProbe = await fs.realpath(probe);
    if (realProbe !== realRoot && !realProbe.startsWith(realRoot + nodePath.sep)) throw new Error('A folder in the project points outside it, so it was not written.');
  }

  /** Write reviewed changes into the real folder. Nothing is overwritten without a backup. */
  async function sync(id, { applyDeletes = false, overwriteConflicts = false } = {}) {
    const meta = await loadMeta(id);
    if (!(await fs.stat(meta.source).catch(() => null))) throw new Error('The original folder no longer exists, so there is nowhere to sync to.');
    const report = await changes(id);
    const conflictSet = new Set(report.conflicts);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const written = []; const deletedList = []; const skippedList = [];
    const root = filesRoot(id);
    for (const rel of [...report.added, ...report.modified]) {
      if (conflictSet.has(rel) && !overwriteConflicts) { skippedList.push({ path: rel, reason: 'changed in the original folder since you opened it' }); continue; }
      try {
        await assertRealParentInside(meta.source, rel);
        const buffer = await fs.readFile(resolveInside(root, rel));
        const target = resolveInside(meta.source, rel);
        const existing = await fs.lstat(target).catch(() => null);
        if (existing && !existing.isFile()) { skippedList.push({ path: rel, reason: 'a folder or special file is in the way' }); continue; }
        if (existing) await backupReal(id, meta, stamp, rel);
        await fs.mkdir(nodePath.dirname(target), { recursive: true });
        await atomicWriteFile(target, buffer, { mode: existing ? (existing.mode & 0o777) : 0o644, encoding: null });
        meta.baseline[rel] = { h: sha1(buffer), s: buffer.length };
        written.push(rel);
      } catch (error) { skippedList.push({ path: rel, reason: error.message }); }
    }
    for (const rel of report.deleted) {
      if (!applyDeletes) { skippedList.push({ path: rel, reason: 'deletion not requested' }); continue; }
      if (conflictSet.has(rel) && !overwriteConflicts) { skippedList.push({ path: rel, reason: 'changed in the original folder since you opened it' }); continue; }
      try {
        await assertRealParentInside(meta.source, rel);
        await backupReal(id, meta, stamp, rel);
        await fs.rm(resolveInside(meta.source, rel), { force: true });
        delete meta.baseline[rel];
        deletedList.push(rel);
      } catch (error) { skippedList.push({ path: rel, reason: error.message }); }
    }
    meta.syncedAt = Date.now();
    await saveMeta(id, meta);
    return { written, deleted: deletedList, skipped: skippedList, backupFolder: written.length || deletedList.length ? nodePath.join(dirFor(id), 'backups', stamp) : null };
  }

  /** Bring changes made in the original folder into the sandbox without touching anything you edited. */
  async function pull(id) {
    const meta = await loadMeta(id);
    if (!(await fs.stat(meta.source).catch(() => null))) throw new Error('The original folder no longer exists.');
    const skipped = emptySkipped();
    const realFiles = await walk(meta.source, skipped);
    const local = await changeSet(id, meta, filesRoot(id));
    const localChanged = new Set([...local.added, ...local.modified, ...local.deleted]);
    const root = filesRoot(id);
    const updated = []; const added = []; const removed = []; const conflicts = [];
    const realSet = new Set(realFiles);
    for (const rel of realFiles) {
      const real = await realHash(meta.source, rel);
      if (real.state !== 'file') continue;
      const base = meta.baseline[rel];
      if (base && real.hash === base.h) continue;
      if (localChanged.has(rel)) { conflicts.push(rel); continue; }
      let buffer;
      try { buffer = await readText(resolveInside(meta.source, rel)); } catch (_) { continue; }
      const to = resolveInside(root, rel);
      await fs.mkdir(nodePath.dirname(to), { recursive: true });
      await fs.writeFile(to, buffer);
      meta.baseline[rel] = { h: sha1(buffer), s: buffer.length };
      (base ? updated : added).push(rel);
    }
    for (const rel of Object.keys(meta.baseline)) {
      if (realSet.has(rel)) continue;
      if (!(await exists(resolveInside(meta.source, rel)))) {
        if (localChanged.has(rel)) { conflicts.push(rel); continue; }
        await fs.rm(resolveInside(root, rel), { force: true });
        delete meta.baseline[rel];
        removed.push(rel);
      }
    }
    await saveMeta(id, meta);
    const touched = [...updated, ...added, ...removed];
    if (touched.length) onChange(id, touched);
    return { updated, added, removed, conflicts: [...new Set(conflicts)] };
  }

  /* ---------- tools used by the AI ---------- */
  const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}… [truncated]` : text);

  async function runTool(id, name, args = {}) {
    const meta = await loadMeta(id);
    const touched = [];
    const wrapped = (...a) => a;
    void wrapped;
    switch (name) {
      case 'status': {
        const set = await changeSet(id, meta, filesRoot(id));
        const entries = (await localFiles(id)).filter(entry => entry.type === 'file');
        return `Project “${meta.name}” (sandbox copy, ${entries.length} files). Changes not yet synced to the real folder: ${set.added.length} new, ${set.modified.length} modified, ${set.deleted.length} deleted.${set.modified.length ? `\nModified: ${set.modified.slice(0, 20).join(', ')}` : ''}${set.added.length ? `\nNew: ${set.added.slice(0, 20).join(', ')}` : ''}${set.deleted.length ? `\nDeleted: ${set.deleted.slice(0, 20).join(', ')}` : ''}`;
      }
      case 'list': {
        const prefix = cleanRel(args.path || '', { allowEmpty: true });
        const recursive = args.recursive === true;
        const all = await localFiles(id);
        const depthOf = rel => rel.split('/').length;
        const base = prefix ? prefix.split('/').length : 0;
        const rows = all.filter(entry => (!prefix || entry.path.startsWith(`${prefix}/`)) && (recursive || depthOf(entry.path) === base + 1));
        if (prefix && !all.some(entry => entry.path === prefix && entry.type === 'dir')) throw new Error(`The folder “${prefix}” does not exist.`);
        if (!rows.length) return '(empty)';
        const shown = rows.slice(0, 300).map(entry => (entry.type === 'dir' ? `${entry.path}/` : `${entry.path}  (${entry.size} bytes)`));
        return shown.join('\n') + (rows.length > 300 ? `\n… ${rows.length - 300} more. List a subfolder to see them.` : '');
      }
      case 'read': {
        const file = await readFile(id, args.path);
        const lines = file.content.split('\n');
        const start = Math.max(1, Math.round(Number(args.start_line) || 1));
        const end = Math.min(lines.length, Math.round(Number(args.end_line) || start + 399));
        const slice = lines.slice(start - 1, end).map((line, i) => `${String(start + i).padStart(5)}  ${line}`).join('\n');
        return clip(`${file.path} (${lines.length} lines)\n${slice}`, 24000) + (end < lines.length ? `\n… ${lines.length - end} more lines. Use start_line=${end + 1} to continue.` : '');
      }
      case 'search': {
        const result = await search(id, args.query, { regex: args.regex === true, rel: args.path || '' });
        if (!result.hits.length) return `No matches in ${result.scanned} files.`;
        return result.hits.map(hit => `${hit.path}:${hit.line}: ${hit.text}`).join('\n') + (result.truncated ? '\n… more matches exist; narrow the search.' : '');
      }
      case 'write': {
        const out = await writeFile(id, args.path, args.content);
        touched.push(out.path);
        return `${out.created ? 'Created' : 'Wrote'} ${out.path} (${out.size} bytes) in the sandbox. The real folder is unchanged until the user syncs.`;
      }
      case 'edit': {
        const out = await editFile(id, args.path, args.old, args.new, args.replace_all === true);
        touched.push(out.path);
        return `Edited ${out.path}: ${out.replacements} replacement${out.replacements === 1 ? '' : 's'}.`;
      }
      case 'delete': {
        const out = await deleteEntry(id, args.path);
        touched.push(out.path);
        return `Deleted ${out.path} from the sandbox.`;
      }
      case 'rename': {
        const out = await renameEntry(id, args.from, args.to);
        touched.push(out.from, out.to);
        return `Moved ${out.from} to ${out.to}.`;
      }
      default: throw new Error(`Unknown project tool “${name}”.`);
    }
  }

  return { listSandboxes, importFolder, removeSandbox, get, tree, readFile, writeFile, makeDir, deleteEntry, renameEntry, editFile, search, changes, sync, pull, runTool };
}

module.exports = { createSandboxService, cleanRel, resolveInside, walk, IGNORED_DIRS, MAX_FILE_BYTES, MAX_FILES };
