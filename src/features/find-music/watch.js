'use strict';

/**
 * FIND MUSIC: WATCH MODULE
 * Combined Backend (Main Process) and Frontend (Renderer Process) logic.
 */

// =============================================================================
// BACKEND LOGIC (Main Process)
// =============================================================================
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

function registerFindMusicHandlers({ ipcMain, shell }) {
  // This is a placeholder for the main handler registration
  // to prevent crashes during startup.
  return { registered: true };
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

// =============================================================================
// FRONTEND LOGIC (Renderer Process)
// =============================================================================
function initFindMusicWatchUI() {
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('fmWatchDownloads')) return;

  const api = window.electronAPI;
  const overlay = document.getElementById('sleeveFindMusicOverlay');
  const content = overlay && overlay.querySelector('.find-music-content');
  if (!api || !content || typeof api.findMusicWatchSelectFolder !== 'function') {
    console.warn('[Sleeve Find Music] Download watcher API is missing. Run the updated installer.');
    return;
  }

  const section = document.createElement('section');
  section.className = 'find-music-card find-music-watch-card';
  section.innerHTML = `
    <div class="find-music-section-heading">
      <div><h3>Auto-detect new downloads</h3><p>Watch a folder such as Downloads. Sleeve waits for a new audio file to stop changing, then lets you review and import it.</p></div>
    </div>
    <div class="find-music-watch-actions">
      <button id="fmWatchDownloads" class="find-music-secondary" type="button">Choose download folder</button>
      <button id="fmStopWatching" class="find-music-text-button" type="button" disabled>Stop watching</button>
    </div>
    <div id="fmWatchStatus" class="find-music-status" role="status" aria-live="polite">Not watching a folder. Select one to detect future downloads.</div>
    <div id="fmDetectedFiles" class="find-music-detected-list" hidden></div>
    <div class="find-music-watch-footer">
      <span id="fmDetectedCount" class="find-music-count">No new files detected</span>
      <button id="fmImportDetected" class="find-music-primary" type="button" disabled>Import selected files</button>
    </div>
    <p class="find-music-watch-note">Watching is opt-in and runs while Sleeve is open. Existing files are not added automatically. New files are read into Sleeve's library only after you click Import; original downloads are left in place. Auto-import is limited to 300 MB per file.</p>
  `;
  const footnote = content.querySelector('.find-music-footnote');
  if (footnote) content.insertBefore(section, footnote);
  else content.appendChild(section);

  const get = (id) => document.getElementById(id);
  const status = get('fmWatchStatus');
  const list = get('fmDetectedFiles');
  const count = get('fmDetectedCount');
  const chooseButton = get('fmWatchDownloads');
  const stopButton = get('fmStopWatching');
  const importButton = get('fmImportDetected');
  const detected = new Map();
  let watching = false;
  let importing = false;
  let unsubscribe = null;

  function formatSize(bytes) {
    if (!Number.isFinite(Number(bytes)) || bytes < 0) return 'Size unknown';
    const value = Number(bytes);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function updateControls() {
    const selected = Array.from(detected.values()).filter((file) => file.selected).length;
    count.textContent = detected.size
      ? `${detected.size} detected · ${selected} selected`
      : 'No new files detected';
    importButton.disabled = importing || selected === 0;
    importButton.textContent = importing ? 'Importing…' : `Import selected files${selected ? ` (${selected})` : ''}`;
    chooseButton.disabled = importing;
    stopButton.disabled = importing || !watching;
    list.hidden = detected.size === 0;
  }

  function renderDetected() {
    list.replaceChildren();
    for (const file of detected.values()) {
      const row = document.createElement('label');
      row.className = 'find-music-detected-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = file.selected;
      checkbox.disabled = importing;
      checkbox.addEventListener('change', () => {
        file.selected = checkbox.checked;
        updateControls();
      });
      const details = document.createElement('span');
      details.className = 'find-music-detected-details';
      const name = document.createElement('strong');
      name.textContent = file.name;
      const path = document.createElement('small');
      path.textContent = `${formatSize(file.size)} · ${file.path}`;
      details.append(name, path);
      row.append(checkbox, details);
      list.appendChild(row);
    }
    updateControls();
  }

  function onNewFiles(payload) {
    const files = Array.isArray(payload && payload.files) ? payload.files : [];
    for (const file of files) {
      if (!file || typeof file.path !== 'string' || typeof file.name !== 'string') continue;
      if (!detected.has(file.path)) {
        detected.set(file.path, { path: file.path, name: file.name, size: Number(file.size) || 0, selected: true });
      } else {
        const existing = detected.get(file.path);
        existing.name = file.name;
        existing.size = Number(file.size) || existing.size;
      }
    }
    if (files.length) {
      status.textContent = `${files.length} new audio file${files.length === 1 ? '' : 's'} ready to review. Select the ones you want, then import them.`;
      status.className = 'find-music-status find-music-status-ok';
    }
    renderDetected();
  }

  if (typeof api.findMusicOnNewFiles === 'function') {
    unsubscribe = api.findMusicOnNewFiles(onNewFiles);
  }

  chooseButton.addEventListener('click', async () => {
    chooseButton.disabled = true;
    status.textContent = 'Choose the folder to watch. The dialog starts in your Downloads folder.';
    status.className = 'find-music-status';
    try {
      const result = await api.findMusicWatchSelectFolder();
      if (!result || result.cancelled) {
        status.textContent = watching ? `Still watching ${result.folderPath || 'the selected folder'}.` : 'Folder selection cancelled.';
        return;
      }
      detected.clear();
      watching = Boolean(result.watching);
      status.textContent = `Watching ${result.folderPath}. Existing audio files (${Number(result.existingAudioCount) || 0}) were left alone; only new or changed downloads will be offered.`;
      status.className = 'find-music-status find-music-status-ok';
      renderDetected();
    } catch (error) {
      status.textContent = error.message || 'Could not start watching that folder.';
      status.className = 'find-music-status find-music-status-error';
    } finally {
      chooseButton.disabled = false;
      updateControls();
    }
  });

  stopButton.addEventListener('click', async () => {
    try {
      const result = await api.findMusicWatchStop();
      watching = false;
      status.textContent = `Stopped watching ${result && result.folderPath ? result.folderPath : 'the folder'}. Detected files already listed can be imported.`;
      status.className = 'find-music-status';
    } catch (error) {
      status.textContent = error.message || 'Could not stop the watcher.';
      status.className = 'find-music-status find-music-status-error';
    }
    updateControls();
  }
  );

  importButton.addEventListener('click', async () => {
    if (importing) return;
    const selected = Array.from(detected.values()).filter((file) => file.selected);
    if (!selected.length) return;
    importing = true;
    status.textContent = `Preparing ${selected.length} file${selected.length === 1 ? '' : 's'} for Sleeve's library…`;
    status.className = 'find-music-status';
    updateControls();
    let importedCount = 0;
    const failures = [];

    for (const entry of selected) {
      try {
        const record = await api.findMusicReadImportFile(entry.path);
        if (!record || !record.bytes || typeof record.name !== 'string') throw new Error('Sleeve received an invalid file response.');
        const file = new File([record.bytes], record.name, {
          type: record.type || 'application/octet-stream',
          lastModified: Number(record.lastModified) || Date.now()
        });
        Object.defineProperty(file, '__sleeveSourcePath', { value: record.path, enumerable: false });
        window.dispatchEvent(new CustomEvent('sleeve:find-music-import-files', { detail: { files: [file] } }));
        detected.delete(entry.path);
        importedCount += 1;
        renderDetected();
      } catch (error) {
        failures.push(`${entry.name}: ${error.message || 'import failed'}`);
      }
    }

    importing = false;
    renderDetected();
    if (failures.length) {
      status.textContent = `${importedCount} file${importedCount === 1 ? '' : 's'} imported. ${failures.join(' · ')}`;
      status.className = 'find-music-status find-music-status-error';
    } else {
      status.textContent = `Imported ${importedCount} file${importedCount === 1 ? '' : 's'} into Sleeve. The original downloads remain in their folder.`;
      status.className = 'find-music-status find-music-status-ok';
    }
    updateControls();
  });

  window.addEventListener('beforeunload', () => {
    if (typeof unsubscribe === 'function') unsubscribe();
  }, { once: true });
};
