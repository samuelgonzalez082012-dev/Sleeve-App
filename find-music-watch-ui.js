/* Optional watched-download import UI for Sleeve Find Music. */
(() => {
  'use strict';

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
    if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return 'Size unknown';
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
      status.textContent = `Stopped watching ${result && result.folderPath ? result.folderPath : 'the folder'}. Detected files already listed can still be imported.`;
      status.className = 'find-music-status';
    } catch (error) {
      status.textContent = error.message || 'Could not stop the watcher.';
      status.className = 'find-music-status find-music-status-error';
    }
    updateControls();
  });

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
})();
