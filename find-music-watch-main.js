'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.wave', '.ogg', '.oga', '.opus', '.m4a', '.m4b', '.aac',
  '.flac', '.alac', '.wma', '.aiff', '.aif', '.ape', '.wv', '.dsf', '.dff',
  '.mpc', '.mid', '.midi'
]);
const MAX_WALK_DEPTH = 3;
const MAX_DISCOVERED_FILES = 5000;
const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;
const STABLE_ROUNDS_REQUIRED = 3;

function isSupportedAudioFile(filePath) {
  return AUDIO_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function signature(entry) {
  return `${entry.size}:${entry.mtimeMs}`;
}

function mimeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wave': 'audio/wav',
    '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
    '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac',
    '.flac': 'audio/flac', '.alac': 'audio/mp4', '.wma': 'audio/x-ms-wma',
    '.aiff': 'audio/aiff', '.aif': 'audio/aiff', '.ape': 'audio/ape',
    '.wv': 'audio/wavpack', '.dsf': 'audio/dsd', '.dff': 'audio/dsd',
    '.mpc': 'audio/musepack', '.mid': 'audio/midi', '.midi': 'audio/midi'
  };
  return types[ext] || 'application/octet-stream';
}

async function scanAudioFolder(root, maxDepth = MAX_WALK_DEPTH) {
  const results = [];
  async function walk(dir, depth) {
    if (results.length >= MAX_DISCOVERED_FILES) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const item of entries) {
      if (results.length >= MAX_DISCOVERED_FILES) return;
      if (item.name.startsWith('.')) continue;
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (depth < maxDepth) await walk(fullPath, depth + 1);
        continue;
      }
      if (!item.isFile() || !isSupportedAudioFile(fullPath)) continue;
      try {
        const stat = await fs.promises.stat(fullPath);
        if (!stat.isFile() || stat.size <= 0) continue;
        results.push({
          path: path.resolve(fullPath),
          name: item.name,
          size: stat.size,
          mtimeMs: stat.mtimeMs
        });
      } catch (_) {
        // A download may be moving or deleting this file; retry on the next scan.
      }
    }
  }
  await walk(root, 0);
  return results;
}

function registerFindMusicWatchHandlers({ ipcMain, app, BrowserWindow }) {
  if (!ipcMain || !app || !BrowserWindow) {
    throw new TypeError('ipcMain, app, and BrowserWindow are required');
  }
  const { dialog } = require('electron');

  let activeFolder = null;
  let timer = null;
  let scanning = false;
  let known = new Map();
  let pending = new Map();
  let reported = new Map();
  const importedPaths = new Set();

  function emitNewFiles(files) {
    if (!files.length) return;
    const payload = {
      files: files.map((entry) => ({
        path: entry.path,
        name: entry.name,
        size: entry.size,
        lastModified: entry.mtimeMs
      }))
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('find-music:watch:new-files', payload);
    }
  }

  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function pollFolder() {
    if (!activeFolder || scanning) return;
    scanning = true;
    try {
      const entries = await scanAudioFolder(activeFolder);
      const currentlyFound = new Set(entries.map((entry) => entry.path));
      const discovered = [];

      for (const entry of entries) {
        const filePath = entry.path;
        const currentSignature = signature(entry);
        if (importedPaths.has(filePath)) {
          known.set(filePath, currentSignature);
          pending.delete(filePath);
          reported.delete(filePath);
          continue;
        }

        const existingReport = reported.get(filePath);
        if (existingReport && signature(existingReport) !== currentSignature) {
          // The file changed after appearing in the list; wait for it to settle again.
          reported.delete(filePath);
          pending.set(filePath, { sig: currentSignature, stableRounds: 0, entry });
        }

        const previousSignature = known.get(filePath);
        const pendingEntry = pending.get(filePath);
        if (!pendingEntry && previousSignature === currentSignature) continue;

        let nextPending = pendingEntry;
        if (!nextPending || nextPending.sig !== currentSignature) {
          nextPending = { sig: currentSignature, stableRounds: 0, entry };
          pending.set(filePath, nextPending);
        } else {
          nextPending.stableRounds += 1;
          nextPending.entry = entry;
        }
        known.set(filePath, currentSignature);

        if (nextPending.stableRounds >= STABLE_ROUNDS_REQUIRED && !reported.has(filePath)) {
          pending.delete(filePath);
          reported.set(filePath, entry);
          discovered.push(entry);
        }
      }

      // Clear stale inventory for files that disappeared, so a later re-download
      // using the same filename can be detected as a new arrival.
      for (const filePath of pending.keys()) {
        if (!currentlyFound.has(filePath)) pending.delete(filePath);
      }
      for (const filePath of known.keys()) {
        if (!currentlyFound.has(filePath)) {
          known.delete(filePath);
          importedPaths.delete(filePath);
          reported.delete(filePath);
        }
      }
      for (const filePath of reported.keys()) {
        if (!currentlyFound.has(filePath)) reported.delete(filePath);
      }

      emitNewFiles(discovered);
    } catch (error) {
      console.warn('[Sleeve Find Music] Download-folder scan failed:', error.message);
    } finally {
      scanning = false;
    }
  }

  ipcMain.handle('find-music:watch-select-folder', async () => {
    const defaultPath = app.getPath('downloads');
    const options = {
      title: 'Choose the folder Sleeve should watch for new music downloads',
      defaultPath,
      properties: ['openDirectory']
    };
    const focused = BrowserWindow.getFocusedWindow();
    const result = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { cancelled: true, watching: Boolean(timer), folderPath: activeFolder || '' };
    }

    stopPolling();
    const selectedPath = path.resolve(result.filePaths[0]);
    const root = await fs.promises.realpath(selectedPath);
    const stat = await fs.promises.stat(root);
    if (!stat.isDirectory()) throw new Error('Please choose a folder, not a file.');

    activeFolder = root;
    pending = new Map();
    reported = new Map();
    known = new Map();
    for (const entry of await scanAudioFolder(root)) known.set(entry.path, signature(entry));

    timer = setInterval(() => { void pollFolder(); }, POLL_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return {
      cancelled: false,
      watching: true,
      folderPath: root,
      existingAudioCount: known.size,
      pollIntervalMs: POLL_INTERVAL_MS
    };
  });

  ipcMain.handle('find-music:watch-stop', async () => {
    stopPolling();
    return { watching: false, folderPath: activeFolder || '' };
  });

  ipcMain.handle('find-music:read-import-file', async (_event, rawPath) => {
    if (!activeFolder) throw new Error('Choose a download folder first.');
    if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('Invalid detected file path.');
    const filePath = path.resolve(rawPath);
    if (!isPathInside(activeFolder, filePath) || !isSupportedAudioFile(filePath)) {
      throw new Error('Sleeve blocked importing a file outside the watched music folder.');
    }
    const reportedEntry = reported.get(filePath);
    if (!reportedEntry) throw new Error('That file is no longer in the detected-download list. Choose the folder again and wait for the file to be detected.');

    const realFilePath = await fs.promises.realpath(filePath);
    if (!isPathInside(activeFolder, realFilePath)) throw new Error('The detected file resolves outside the watched folder.');
    const stat = await fs.promises.stat(realFilePath);
    if (!stat.isFile() || stat.size <= 0) throw new Error('The detected file is empty or is no longer available.');
    if (stat.size > MAX_IMPORT_BYTES) {
      throw new Error(`This file is ${Math.round(stat.size / (1024 * 1024))} MB. The auto-import limit is 300 MB per file; use Sleeve's regular Add Media picker for larger files.`);
    }
    if (stat.size !== reportedEntry.size || stat.mtimeMs !== reportedEntry.mtimeMs) {
      throw new Error('This download is still changing. Wait a few seconds for it to finish, then try again.');
    }

    const buffer = await fs.promises.readFile(realFilePath);
    if (buffer.length !== stat.size) throw new Error('The file changed while Sleeve was reading it. Try again after the download finishes.');

    // Typed arrays are structured-cloneable; do not send functions or Node streams through Electron IPC.
    const response = {
      path: realFilePath,
      name: path.basename(realFilePath),
      type: mimeForPath(realFilePath),
      lastModified: stat.mtimeMs,
      bytes: Uint8Array.from(buffer)
    };
    reported.delete(filePath);
    importedPaths.add(filePath);
    return response;
  });

  app.on('before-quit', stopPolling);
  return { stop: stopPolling, isSupportedAudioFile, scanAudioFolder };
}

module.exports = {
  registerFindMusicWatchHandlers,
  isSupportedAudioFile,
  isPathInside,
  signature,
  mimeForPath,
  scanAudioFolder
};
