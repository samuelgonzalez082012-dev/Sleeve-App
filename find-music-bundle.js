/* GENERATED FILE — do not hand-edit. Source lives under src/features/find-music/ui/. *//* Rebuild with: node scripts/build-find-music-bundle.js *//* Source order: find-music.js -> find-music-watch-ui.js -> find-music-download-ui.js -> find-music-import-core.js -> find-music-import-ui.js -> find-music-convert-ui.js */
/* ===== BEGIN find-music.js ===== */
/* Sleeve Find Music: catalog discovery + authorized local-file import. */
(() => {
  'use strict';

  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('sleeveFindMusicButton')) return;

  const api = window.electronAPI;
  if (!api || typeof api.findMusicSearchRecordings !== 'function') {
    console.warn('[Sleeve Find Music] Preload API is missing. Run install-find-music.js again.');
    return;
  }

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const nav = document.querySelector('.nav');
  if (!nav) return;

  const navButton = document.createElement('button');
  navButton.type = 'button';
  navButton.className = 'nav-item sleeve-find-music-nav';
  navButton.id = 'sleeveFindMusicButton';
  navButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/><path d="M8 10.8h5.6"/></svg><span>Find Music</span>';
  nav.appendChild(navButton);

  const overlay = document.createElement('div');
  overlay.className = 'find-music-overlay';
  overlay.id = 'sleeveFindMusicOverlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="find-music-panel" role="dialog" aria-modal="true" aria-labelledby="findMusicTitle">
      <header class="find-music-header">
        <div class="find-music-heading">
          <span class="find-music-kicker">SLEEVE LIBRARY TOOLS</span>
          <h2 id="findMusicTitle">Find Music</h2>
          <p>Paste a music link, resolve the track list, then download eligible audio directly into your Sleeve library.</p>
        </div>
        <button class="find-music-close" type="button" aria-label="Close Find Music">×</button>
      </header>

      <div class="find-music-content">
        <section class="find-music-card">
          <h3>1. Identify the recording</h3>
          <label for="fmReferenceUrl">Music link <span class="find-music-optional">optional</span></label>
          <div class="find-music-link-row">
            <input id="fmReferenceUrl" type="url" placeholder="Paste a Spotify, Apple Music, YouTube Music, or store link" autocomplete="off" spellcheck="false">
            <button id="fmInspectLink" class="find-music-secondary" type="button">Check link</button>
          </div>
          <div id="fmLinkStatus" class="find-music-status" aria-live="polite">You can search by title and artist without a link.</div>
          <div class="find-music-fields">
            <div><label for="fmTitle">Track title <span class="find-music-required">required</span></label><input id="fmTitle" type="text" maxlength="240" placeholder="Song title"></div>
            <div><label for="fmArtist">Artist <span class="find-music-required">required unless ISRC is supplied</span></label><input id="fmArtist" type="text" maxlength="240" placeholder="Artist name"></div>
            <div><label for="fmAlbum">Album <span class="find-music-optional">optional</span></label><input id="fmAlbum" type="text" maxlength="240" placeholder="Album title"></div>
            <div><label for="fmDuration">Duration, seconds <span class="find-music-optional">optional</span></label><input id="fmDuration" type="number" min="1" max="86400" step="1" placeholder="e.g. 214"></div>
            <div class="find-music-isrc"><label for="fmIsrc">ISRC <span class="find-music-optional">optional</span></label><input id="fmIsrc" type="text" maxlength="16" placeholder="e.g. USABC2300001" autocapitalize="characters"></div>
          </div>
          <div class="find-music-controls">
            <div class="find-music-preference-wrap"><label for="fmPreference">Prioritize source links</label><select id="fmPreference"><option value="free">Free options first</option><option value="lossless">Lossless stores first</option><option value="cheapest">Lower-cost options first</option><option value="all">Show all options</option></select></div>
            <button id="fmSearchBtn" class="find-music-primary" type="button">Search recording metadata</button>
          </div>
        </section>

        <div id="fmFeedback" class="find-music-feedback" role="status" aria-live="polite" hidden></div>

        <section id="fmMatchesSection" class="find-music-card" hidden>
          <div class="find-music-section-heading"><div><h3>2. Recording matches</h3><p>MusicBrainz results are metadata candidates. Store links are external discovery links; eligible direct-download files are downloaded in Sleeve.</p></div><span id="fmMatchCount" class="find-music-count"></span></div>
          <div id="fmMatches" class="find-music-matches"></div>
        </section>

        <section id="fmSourcesSection" class="find-music-card" hidden>
          <div class="find-music-section-heading"><div><h3>3. Official store links</h3><p>These are discovery links, not direct downloads. They open in your normal external browser; direct open-license audio downloads happen in Sleeve above.</p></div></div>
          <div id="fmSources" class="find-music-sources"></div>
        </section>

        <section class="find-music-card find-music-import-card">
          <div><h3>Already downloaded the file?</h3><p>Import it into Sleeve's existing library. Use a source that permits a permanent download; this feature does not extract audio from streaming links.</p></div>
          <button id="fmImportFiles" class="find-music-secondary" type="button">Import downloaded files</button>
        </section>
        <p class="find-music-footnote">The quick workflow supports Spotify track, album, and playlist metadata plus direct downloads from supported, explicitly licensed sources. Advanced tools remain available below. Sleeve never downloads audio from streaming sessions.</p>
      </div>
    </section>`;
  document.body.appendChild(overlay);

  const get = (id) => document.getElementById(id);
  const referenceInput = get('fmReferenceUrl');
  const linkStatus = get('fmLinkStatus');
  const feedback = get('fmFeedback');
  const matchesSection = get('fmMatchesSection');
  const sourcesSection = get('fmSourcesSection');
  const matchesEl = get('fmMatches');
  const sourcesEl = get('fmSources');
  let currentReference = null;
  let lastSearchPayload = null;
  let busy = false;
  let stateEpoch = 0;

  function setFeedback(message, kind = 'info') {
    feedback.hidden = !message;
    feedback.textContent = message || '';
    feedback.className = `find-music-feedback find-music-feedback-${kind}`;
  }

  function setBusy(value) {
    busy = Boolean(value);
    get('fmSearchBtn').disabled = busy;
    get('fmInspectLink').disabled = busy;
    get('fmSearchBtn').textContent = busy ? 'Searching…' : 'Search recording metadata';
  }

  function openPanel() {
    overlay.hidden = false;
    document.body.classList.add('find-music-open');
    setTimeout(() => referenceInput.focus(), 0);
  }

  function resetPanelState() {
    // Increment the generation so late responses from an older request cannot
    // repaint the UI after the user has closed Find Music.
    stateEpoch += 1;
    currentReference = null;
    lastSearchPayload = null;
    setBusy(false);
    for (const id of ['fmReferenceUrl', 'fmTitle', 'fmArtist', 'fmAlbum', 'fmDuration', 'fmIsrc']) {
      const field = get(id);
      if (field) field.value = '';
    }
    const preference = get('fmPreference');
    if (preference) preference.value = 'free';
    linkStatus.textContent = 'You can search by title and artist without a link.';
    linkStatus.className = 'find-music-status';
    clearResults();
    setFeedback('', 'info');
    // Optional feature modules clear their own inputs, result lists and progress.
    document.dispatchEvent(new CustomEvent('sleeve:find-music-reset'));
  }

  function closePanel(restoreFocus = true) {
    if (!overlay.hidden) resetPanelState();
    overlay.hidden = true;
    document.body.classList.remove('find-music-open');
    if (restoreFocus) navButton.focus();
  }

  function clearResults() {
    matchesSection.hidden = true;
    sourcesSection.hidden = true;
    matchesEl.replaceChildren();
    sourcesEl.replaceChildren();
    get('fmMatchCount').textContent = '';
  }

  function durationLabel(seconds) {
    if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return 'Duration unavailable';
    const value = Math.round(Number(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  async function openTrusted(url) {
    try {
      await api.findMusicOpenUrl(url);
    } catch (error) {
      setFeedback(error.message || 'Could not open that link in your browser.', 'error');
    }
  }

  function renderMatches(results) {
    matchesEl.replaceChildren();
    get('fmMatchCount').textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'find-music-empty';
      empty.textContent = 'No matching recording metadata was found. Try correcting the title/artist or add an ISRC.';
      matchesEl.appendChild(empty);
      matchesSection.hidden = false;
      return;
    }

    for (const result of results) {
      const card = document.createElement('article');
      card.className = 'find-music-match';
      const title = document.createElement('div');
      title.className = 'find-music-match-main';
      const h4 = document.createElement('h4');
      h4.textContent = result.title || 'Unknown title';
      const details = document.createElement('p');
      details.textContent = [result.artist, result.album, durationLabel(result.durationSec), result.releaseDate].filter(Boolean).join(' · ');
      title.append(h4, details);
      const badge = document.createElement('span');
      const score = Number(result.matchScore || 0);
      badge.className = `find-music-score ${result.exactIsrc ? 'find-music-score-exact' : ''}`;
      badge.textContent = result.exactIsrc ? 'Exact ISRC' : `${Math.round(score * 100)}% match`;
      const footer = document.createElement('div');
      footer.className = 'find-music-match-footer';
      const notes = document.createElement('span');
      notes.textContent = [result.disambiguation, result.isrcs && result.isrcs.length ? `ISRC: ${result.isrcs.slice(0, 2).join(', ')}` : ''].filter(Boolean).join(' · ');
      footer.appendChild(notes);
      if (result.musicBrainzUrl) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'find-music-text-button';
        open.textContent = 'View recording';
        open.addEventListener('click', () => openTrusted(result.musicBrainzUrl));
        footer.appendChild(open);
      }
      card.append(title, badge, footer);
      matchesEl.appendChild(card);
    }
    matchesSection.hidden = false;
  }

  function renderSources(providerLinks) {
    sourcesEl.replaceChildren();
    for (const provider of providerLinks || []) {
      const card = document.createElement('article');
      card.className = 'find-music-source';
      const copy = document.createElement('div');
      copy.className = 'find-music-source-copy';
      const name = document.createElement('h4');
      name.textContent = provider.name;
      const description = document.createElement('p');
      description.textContent = provider.description;
      const format = document.createElement('small');
      format.textContent = provider.formatNote;
      copy.append(name, description, format);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'find-music-secondary find-music-store-button';
      button.textContent = 'Open source externally';
      button.addEventListener('click', () => openTrusted(provider.searchUrl));
      card.append(copy, button);
      sourcesEl.appendChild(card);
    }
    sourcesSection.hidden = !(providerLinks && providerLinks.length);
  }

  navButton.addEventListener('click', openPanel);
  // Treat choosing another app navigation item as leaving the Find Music tab.
  nav.addEventListener('click', (event) => {
    const clickedNavItem = event.target && event.target.closest ? event.target.closest('button.nav-item') : null;
    if (clickedNavItem && clickedNavItem !== navButton && !overlay.hidden) closePanel(false);
  });
  overlay.querySelector('.find-music-close').addEventListener('click', () => closePanel(true));
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (!overlay.hidden && event.key === 'Escape') closePanel();
  });

  get('fmInspectLink').addEventListener('click', async () => {
    const operationEpoch = stateEpoch;
    const raw = referenceInput.value.trim();
    if (!raw) {
      linkStatus.textContent = 'No link supplied. You can search using the title and artist fields.';
      linkStatus.className = 'find-music-status';
      currentReference = null;
      return;
    }
    try {
      const parsedReference = await api.findMusicParseLink(raw);
      if (operationEpoch !== stateEpoch) return;
      currentReference = parsedReference;
      linkStatus.textContent = currentReference.service === 'Spotify' && ['playlist', 'album'].includes(currentReference.type)
        ? `Spotify ${currentReference.type} link recognized. Use the Spotify playlist & album section above to load its track list.`
        : `${currentReference.service} ${currentReference.type} link recognized. Reference ID: ${currentReference.id || '(not detected)'}. Enter or confirm title and artist, then search public recording metadata.`;
      linkStatus.className = 'find-music-status find-music-status-ok';
      const openReference = document.createElement('button');
      openReference.type = 'button';
      openReference.className = 'find-music-text-button';
      openReference.textContent = 'Open original link';
      openReference.addEventListener('click', () => openTrusted(currentReference.url));
      linkStatus.appendChild(document.createTextNode(' '));
      linkStatus.appendChild(openReference);
    } catch (error) {
      if (operationEpoch !== stateEpoch) return;
      currentReference = null;
      linkStatus.textContent = error.message || 'That link could not be validated.';
      linkStatus.className = 'find-music-status find-music-status-error';
    }
  });

  get('fmSearchBtn').addEventListener('click', async () => {
    if (busy) return;
    const operationEpoch = stateEpoch;
    const payload = {
      title: get('fmTitle').value.trim(),
      artist: get('fmArtist').value.trim(),
      album: get('fmAlbum').value.trim(),
      durationSec: Number(get('fmDuration').value) || null,
      isrc: get('fmIsrc').value.trim(),
      preference: get('fmPreference').value
    };
    if (!payload.title && !payload.isrc) {
      setFeedback('Enter a title or an ISRC. A Spotify link alone is kept as a reference in this version.', 'error');
      return;
    }
    if (!payload.isrc && !payload.artist) {
      setFeedback('Enter the artist name to reduce false matches.', 'error');
      return;
    }

    clearResults();
    setBusy(true);
    setFeedback('Searching MusicBrainz for recording metadata. Store availability and file quality are checked on each official site.', 'info');
    try {
      const result = await api.findMusicSearchRecordings(payload);
      if (operationEpoch !== stateEpoch) return;
      lastSearchPayload = payload;
      renderMatches(result.results || []);
      renderSources(result.providerLinks || []);
      const exact = (result.results || []).some((item) => item.exactIsrc);
      setFeedback(
        exact
          ? 'An exact ISRC metadata match was found. Confirm the release version before choosing a store.'
          : `Found ${(result.results || []).length} metadata candidate(s). Review title, artist, duration, and edition before choosing a result.`,
        exact ? 'success' : 'info'
      );
    } catch (error) {
      if (operationEpoch !== stateEpoch) return;
      setFeedback(error.message || 'Search failed. Check your internet connection and try again.', 'error');
    } finally {
      if (operationEpoch === stateEpoch) setBusy(false);
    }
  });

  get('fmImportFiles').addEventListener('click', () => {
    closePanel();
    const addButton = document.getElementById('addBtn');
    if (addButton) addButton.click();
    else setFeedback('Sleeve’s existing Add media button was not found.');
  });

  // When the app is opened with a reference URL passed as a fragment/query,
  // leave it to the user to review rather than silently making assumptions.
  window.SleeveFindMusic = {
    open: openPanel,
    close: closePanel,
    getLastSearch: () => lastSearchPayload
  };
})();

/* ===== END find-music.js ===== */

/* ===== BEGIN find-music-watch-ui.js ===== */
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

/* ===== END find-music-watch-ui.js ===== */

/* ===== BEGIN find-music-download-ui.js ===== */
/* Fully in-app direct download integration for openly licensed audio. No embedded browser. */
(() => {
  'use strict';

  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('fmOpenAudioSection')) return;

  const api = window.electronAPI;
  const overlay = document.getElementById('sleeveFindMusicOverlay');
  const content = overlay && overlay.querySelector('.find-music-content');
  if (!api || !content || typeof api.findMusicSearchOpenAudio !== 'function') {
    console.warn('[Sleeve Find Music] In-app download API is missing. Run the updated installer.');
    return;
  }

  const section = document.createElement('section');
  section.id = 'fmOpenAudioSection';
  section.className = 'find-music-card find-music-open-audio-card';
  section.innerHTML = `
    <div class="find-music-section-heading">
      <div>
        <h3>4. Download eligible music directly in Sleeve</h3>
        <p>Search Internet Archive for audio with an explicitly declared Creative Commons or public-domain license. Use the in-app Download &amp; add button for a direct audio file; no embedded browser is used.</p>
      </div>
    </div>
    <div class="find-music-open-audio-actions">
      <button id="fmSearchOpenAudio" class="find-music-primary" type="button">Search downloadable music</button>
      <span id="fmOpenAudioCount" class="find-music-count">No search yet</span>
    </div>
    <div id="fmOpenAudioFeedback" class="find-music-status" role="status" aria-live="polite">Directly downloaded audio is saved in Music → Sleeve Downloads and added to your library automatically.</div>
    <div id="fmOpenAudioResults" class="find-music-open-audio-results" hidden></div>
    <p class="find-music-watch-note">Only files offered by the source are downloaded. Sleeve doesn’t rip streams. Internet Archive license metadata is supplied by uploaders, so check each item’s rights information; no result is a guarantee that every underlying recording was uploaded correctly.</p>
  `;

  const footnote = content.querySelector('.find-music-footnote');
  const importCard = content.querySelector('.find-music-import-card');
  if (importCard) content.insertBefore(section, importCard);
  else if (footnote) content.insertBefore(section, footnote);
  else content.appendChild(section);

  const get = (id) => document.getElementById(id);
  const feedback = get('fmOpenAudioFeedback');
  const results = get('fmOpenAudioResults');
  const count = get('fmOpenAudioCount');
  const searchButton = get('fmSearchOpenAudio');
  let searching = false;
  let operationEpoch = 0;
  const importingDownloadedPaths = new Set();

  function setStatus(message, kind = 'info') {
    feedback.textContent = message || '';
    feedback.className = `find-music-status${kind === 'success' ? ' find-music-status-ok' : kind === 'error' ? ' find-music-status-error' : ''}`;
  }

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return 'Size unknown';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function prettyFileFormat(file) {
    const ext = String(file.name || '').split('.').pop().toUpperCase();
    const format = String(file.format || ext).trim();
    return `${format} · ${formatSize(file.size)}`;
  }

  function makeText(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    return element;
  }

  async function importDownloadedPath(filePath) {
    if (!filePath || importingDownloadedPaths.has(filePath)) return false;
    importingDownloadedPaths.add(filePath);
    try {
      const record = await api.findMusicReadDownloadedFile(filePath);
      if (!record || !record.bytes || typeof record.name !== 'string') throw new Error('Sleeve received an invalid downloaded file.');
      const file = new File([record.bytes], record.name, {
        type: record.type || 'application/octet-stream',
        lastModified: Number(record.lastModified) || Date.now()
      });
      Object.defineProperty(file, '__sleeveSourcePath', { value: record.path, enumerable: false });
      window.dispatchEvent(new CustomEvent('sleeve:find-music-import-files', { detail: { files: [file] } }));
      return true;
    } finally {
      importingDownloadedPaths.delete(filePath);
    }
  }

  async function downloadFile(item, file, button) {
    if (button.disabled) return;
    const actionEpoch = operationEpoch;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Downloading and importing…';
    setStatus(`Downloading ${file.name} from Internet Archive.`, 'info');
    try {
      const downloaded = await api.findMusicDownloadOpenAudio({ identifier: item.identifier, fileName: file.name });
      await importDownloadedPath(downloaded.path);
      if (actionEpoch === operationEpoch && !overlay.hidden) {
        setStatus(`Downloaded and added “${downloaded.name}” to Sleeve. Saved under Music → Sleeve Downloads. License listed by source: ${downloaded.licenseLabel}.`, 'success');
        button.textContent = 'Downloaded ✓';
      }
    } catch (error) {
      if (actionEpoch === operationEpoch && !overlay.hidden) {
        setStatus(error && error.message ? error.message : 'The download failed. Try another file or source.', 'error');
        button.textContent = oldText;
        button.disabled = false;
      }
    }
  }

  function renderResults(items) {
    results.replaceChildren();
    count.textContent = `${items.length} downloadable item${items.length === 1 ? '' : 's'}`;
    if (!items.length) {
      results.appendChild(makeText('div', 'find-music-empty', 'No explicitly licensed, directly downloadable audio items matched. Try a shorter title, the artist name alone, or another source below.'));
      results.hidden = false;
      return;
    }

    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'find-music-open-audio-result';
      const header = document.createElement('div');
      header.className = 'find-music-open-audio-result-header';
      const heading = document.createElement('div');
      heading.className = 'find-music-open-audio-result-heading';
      heading.appendChild(makeText('h4', '', item.title || 'Untitled audio item'));
      heading.appendChild(makeText('p', '', [item.creator, item.year].filter(Boolean).join(' · ') || 'Creator or date not supplied'));
      const license = makeText('span', 'find-music-license-pill', item.licenseLabel || 'License metadata unavailable');
      header.append(heading, license);
      card.appendChild(header);

      const fileList = document.createElement('div');
      fileList.className = 'find-music-open-audio-files';
      for (const file of Array.isArray(item.files) ? item.files : []) {
        const row = document.createElement('div');
        row.className = 'find-music-open-audio-file';
        const fileDetails = document.createElement('div');
        fileDetails.className = 'find-music-open-audio-file-details';
        fileDetails.appendChild(makeText('strong', '', file.name));
        fileDetails.appendChild(makeText('small', '', prettyFileFormat(file)));
        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'find-music-secondary';
        download.textContent = 'Download & add';
        download.addEventListener('click', () => downloadFile(item, file, download));
        row.append(fileDetails, download);
        fileList.appendChild(row);
      }
      card.appendChild(fileList);
      const sourceNote = makeText('p', 'find-music-source-note', `Direct source: ${item.itemUrl || 'Internet Archive'} · License URL: ${item.licenseUrl || 'not supplied'}`);
      card.appendChild(sourceNote);
      results.appendChild(card);
    }
    results.hidden = false;
  }

  searchButton.addEventListener('click', async () => {
    if (searching) return;
    const searchEpoch = operationEpoch;
    const title = document.getElementById('fmTitle')?.value.trim() || '';
    const artist = document.getElementById('fmArtist')?.value.trim() || '';
    const album = document.getElementById('fmAlbum')?.value.trim() || '';
    if (!title && !artist) {
      setStatus('Enter a title or artist in step 1 first.', 'error');
      return;
    }
    searching = true;
    searchButton.disabled = true;
    searchButton.textContent = 'Searching open-license catalog…';
    count.textContent = 'Searching…';
    results.hidden = true;
    results.replaceChildren();
    setStatus('Searching Internet Archive metadata and verifying each item’s declared license and audio files.', 'info');
    try {
      const response = await api.findMusicSearchOpenAudio({ title, artist, album });
      if (searchEpoch !== operationEpoch || overlay.hidden) return;
      renderResults(response.results || []);
      setStatus(response.note || 'Search complete.', (response.results || []).length ? 'success' : 'info');
    } catch (error) {
      if (searchEpoch !== operationEpoch || overlay.hidden) return;
      count.textContent = 'Search failed';
      setStatus(error && error.message ? error.message : 'Could not search Internet Archive. Check your connection and retry.', 'error');
    } finally {
      if (searchEpoch === operationEpoch) {
        searching = false;
        searchButton.disabled = false;
        searchButton.textContent = 'Search downloadable music';
      }
    }
  });

  document.addEventListener('sleeve:find-music-reset', () => {
    operationEpoch += 1;
    searching = false;
    results.replaceChildren();
    results.hidden = true;
    count.textContent = 'No search yet';
    setStatus('Directly downloaded audio is saved in Music → Sleeve Downloads and added to your library automatically.', 'info');
    searchButton.disabled = false;
    searchButton.textContent = 'Search downloadable music';
  });


})();

/* ===== END find-music-download-ui.js ===== */

/* ===== BEGIN find-music-import-core.js ===== */
(function (root) {
  'use strict';

  const MAX_CSV_BYTES = 10 * 1024 * 1024;
  const MAX_TRACKS = 200;

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .toLowerCase()
      .replace(/\b(featuring|feat\.?|ft\.?)\b/g, ' feat ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[^a-z0-9]/g, '');
  }

  function parseCsvRows(text) {
    const input = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"' && input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"' && cell.length === 0) {
        quoted = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && input[i + 1] === '\n') i += 1;
        row.push(cell);
        if (row.some((value) => String(value).trim() !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    if (quoted) throw new Error('The CSV has an unclosed quoted field. Re-export it as UTF-8 CSV and try again.');
    row.push(cell);
    if (row.some((value) => String(value).trim() !== '')) rows.push(row);
    return rows;
  }

  const ALIASES = {
    title: ['trackname', 'title', 'tracktitle', 'song', 'track', 'songtitle', 'name'],
    artist: ['artistnames', 'artistname', 'artists', 'artist', 'trackartist', 'performer', 'performers'],
    album: ['albumname', 'album', 'albumtitle', 'collectionname', 'release'],
    isrc: ['isrc', 'trackisrc', 'internationalstandardrecordingcode'],
    duration: ['trackdurationms', 'durationms', 'trackduration', 'duration', 'length', 'durationseconds'],
    trackUri: ['trackuri', 'spotifytrackuri'],
    albumUri: ['albumuri', 'spotifyalbumuri'],
    popularity: ['popularity', 'trackpopularity'],
    trackNumber: ['tracknumber', 'trackno', 'tracknum'],
    coverUrl: ['albumimageurl', 'albumartworkurl', 'artworkurl', 'imageurl']
  };

  function findColumn(headers, key) {
    const aliases = ALIASES[key] || [];
    return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
  }

  function parseDuration(value, header = '') {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?\s*:\s*\d{1,2}(?::\d{1,2})?$/.test(raw)) {
      const parts = raw.split(':').map(Number);
      return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const number = Number(raw.replace(/\s*(ms|milliseconds|seconds|secs|s)\s*$/i, ''));
    if (!Number.isFinite(number) || number <= 0) return null;
    if (/ms|millisecond/i.test(header) || number > 1000) return number / 1000;
    if (/second|secs|\(s\)|durationseconds/i.test(header)) return number;
    return number;
  }

  function parseExportifyCsv(text, options = {}) {
    if (typeof text !== 'string') throw new TypeError('Please select a CSV playlist export.');
    if (BufferLikeByteLength(text) > MAX_CSV_BYTES) throw new Error('This CSV is larger than 10 MB. Export a smaller playlist and try again.');
    const rows = parseCsvRows(text);
    if (rows.length < 2) throw new Error('The CSV contains a header but no track rows.');
    const headers = rows[0].map((header) => String(header || '').trim());
    const columns = Object.fromEntries(Object.keys(ALIASES).map((key) => [key, findColumn(headers, key)]));
    if (columns.title < 0 || columns.artist < 0) {
      throw new Error('Sleeve could not identify the track-title and artist columns. Use an Exportify track CSV or a CSV with Title and Artist columns.');
    }

    const tracks = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const value = (column) => column >= 0 ? String(row[column] == null ? '' : row[column]).trim() : '';
      const title = value(columns.title);
      const artist = value(columns.artist);
      if (!title || !artist) continue;
      tracks.push({
        sourceIndex: tracks.length,
        title: title.slice(0, 240),
        artist: artist.slice(0, 240),
        album: value(columns.album).slice(0, 240),
        isrc: value(columns.isrc).replace(/[\s-]/g, '').toUpperCase(),
        durationSec: parseDuration(value(columns.duration), columns.duration >= 0 ? headers[columns.duration] : ''),
        trackUri: value(columns.trackUri),
        albumUri: value(columns.albumUri),
        popularity: Number(value(columns.popularity)) || null,
        trackNumber: Number(value(columns.trackNumber)) || null,
        coverUrl: value(columns.coverUrl),
        status: 'pending',
        message: ''
      });
      if (tracks.length > MAX_TRACKS) throw new Error(`This CSV contains more than ${MAX_TRACKS} tracks. Split the playlist into smaller exports.`);
    }
    if (!tracks.length) throw new Error('No rows contained both a track title and artist. Check the selected CSV.');
    const collectionName = String(options.fileName || 'Imported Playlist').replace(/\.[^.]+$/, '').replace(/[\r\n]/g, ' ').trim().slice(0, 120) || 'Imported Playlist';
    return { collectionName, total: tracks.length, tracks };
  }

  function BufferLikeByteLength(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    return unescape(encodeURIComponent(value)).length;
  }

  function normalizeISRC(value) {
    return String(value || '').replace(/[\s-]/g, '').toUpperCase();
  }

  function trackAlreadyInLibrary(source, libraryTrack) {
    const titleA = normalizeText(source && source.title);
    const titleB = normalizeText(libraryTrack && (libraryTrack.title || libraryTrack.name));
    const artistA = normalizeText(source && source.artist);
    const artistB = normalizeText(libraryTrack && (libraryTrack.artist || libraryTrack.artistText));
    if (!titleA || !titleB || !artistA || !artistB || titleA !== titleB || artistA !== artistB) return false;

    const sourceISRC = normalizeISRC(source && source.isrc);
    const libraryISRC = normalizeISRC(libraryTrack && (libraryTrack.isrc || (libraryTrack.manualMetadata && libraryTrack.manualMetadata.isrc)));
    if (sourceISRC && libraryISRC) return sourceISRC === libraryISRC;

    const sourceDuration = Number(source && source.durationSec) || null;
    const libraryDuration = Number(libraryTrack && libraryTrack.duration) || Number(libraryTrack && libraryTrack.durationSec) || null;
    if (sourceDuration && libraryDuration && Math.abs(sourceDuration - libraryDuration) > 8) return false;
    return true;
  }

  function markAlreadyOwned(tracks, libraryTracks) {
    const library = Array.isArray(libraryTracks) ? libraryTracks : [];
    const seenInImport = [];
    return (Array.isArray(tracks) ? tracks : []).map((track, index) => {
      const copy = { ...track, sourceIndex: Number.isInteger(track.sourceIndex) ? track.sourceIndex : index };
      const existing = library.find((entry) => trackAlreadyInLibrary(copy, entry));
      if (existing) {
        copy.status = 'already-have';
        copy.message = 'Already in your Sleeve library';
        copy.libraryMatchTitle = String(existing.title || existing.name || copy.title);
        return copy;
      }
      if (seenInImport.some((prior) => trackAlreadyInLibrary(copy, prior))) {
        copy.status = 'duplicate-in-playlist';
        copy.message = 'Duplicate of another entry in this import; only one download is needed';
        return copy;
      }
      seenInImport.push(copy);
      copy.status = 'missing';
      copy.message = 'Not found in your Sleeve library';
      return copy;
    });
  }

  const api = { MAX_CSV_BYTES, MAX_TRACKS, parseCsvRows, parseExportifyCsv, normalizeText, normalizeISRC, trackAlreadyInLibrary, markAlreadyOwned, parseDuration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SleeveFindMusicImportCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== END find-music-import-core.js ===== */

/* ===== BEGIN find-music-import-ui.js ===== */
/* Sleeve Find Music: premium-free link metadata + Exportify CSV import.
 * No authenticated Spotify Web API calls are made by this workflow. */
(() => {
  'use strict';
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('fmImportWorkflow')) return;

  const api = window.electronAPI;
  const core = window.SleeveFindMusicImportCore;
  const overlay = document.getElementById('sleeveFindMusicOverlay');
  const content = overlay && overlay.querySelector('.find-music-content');
  if (!api || !core || !content || typeof api.findMusicResolvePublicLink !== 'function' ||
      typeof api.findMusicGetPublicAlbumTracks !== 'function' ||
      typeof api.findMusicDownloadOpenAudioCollection !== 'function') {
    console.warn('[Sleeve Find Music] Premium-free import module missing. Re-run the current installer.');
    return;
  }

  const section = document.createElement('section');
  section.id = 'fmImportWorkflow';
  section.className = 'find-music-card fm-import-workflow';
  section.innerHTML = `
    <div class="fm-import-hero">
      <div class="fm-import-icon" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="fm-import-hero-copy">
        <span class="fm-import-eyebrow">SLEEVE · FIND MUSIC</span>
        <h3>Paste a link. Download audio.</h3>
        <p>Resolve a Spotify link or YouTube video reference, or import an playlist CSV. Sleeve skips songs already in your library and packages eligible missing tracks into one download.</p>
      </div>
    </div>
    <div class="fm-import-input-block">
      <label for="fmImportLink">Spotify track/album or YouTube video link</label>
      <div class="fm-import-link-row">
        <input id="fmImportLink" type="url" maxlength="1000" spellcheck="false" autocomplete="off" placeholder="Paste a Spotify link or YouTube video URL">
        <button id="fmImportResolve" class="find-music-primary" type="button">Resolve</button>
      </div>
      <p class="fm-import-help">No Spotify login or Premium subscription is used by this workflow. Playlist links need an Exportify CSV because a public link preview doesn't include the full track list.</p>
    </div>
    <div class="fm-import-or"><span>OR</span></div>
    <div class="fm-import-csv-row">
      <div><strong>Import a playlist CSV</strong><p>Choose an Exportify export or a CSV with Title and Artist columns. Track order and available ISRC/duration data are preserved.</p></div>
      <button id="fmImportCsvButton" class="find-music-secondary" type="button">Choose CSV file</button>
      <input id="fmImportCsvFile" type="file" accept=".csv,text/csv,text/plain" hidden>
    </div>
    <div id="fmImportStatus" class="find-music-status" role="status" aria-live="polite">Ready. Paste a Spotify track/album or YouTube video link, or import a playlist CSV.</div>
    <div id="fmImportCandidateArea" class="fm-import-candidates" hidden></div>
    <div id="fmImportProgressWrap" class="fm-import-progress" hidden>
      <div class="fm-import-progress-label"><span id="fmImportProgressText">Working…</span><span id="fmImportProgressNumber"></span></div>
      <progress id="fmImportProgress" max="100" value="0"></progress>
      <button id="fmImportCancel" class="find-music-text-button" type="button">Cancel</button>
    </div>
    <div id="fmImportCollection" class="fm-import-collection" hidden>
      <div id="fmImportCollectionHeader" class="fm-import-collection-header"></div>
      <div id="fmImportStats" class="fm-import-stats"></div>
      <div id="fmImportTracks" class="fm-import-track-list"></div>
      <div class="fm-import-download-row">
        <div><strong id="fmImportDownloadSummary">No missing tracks yet</strong><p id="fmImportDownloadHint">Only eligible direct audio downloads will be included.</p></div>
        <button id="fmImportDownload" class="fm-import-download-button" type="button"><span aria-hidden="true">↓</span> Download Audio</button>
      </div>
      <div id="fmImportZipArea" class="fm-import-zip-area" hidden></div>
    </div>
    <p class="fm-import-legal">Sleeve downloads audio only when a supported source provides a direct file with a supported public-domain or open-license declaration. It does not copy Spotify streams or bypass store checkout. Public catalog matches identify recordings; they don't guarantee that a downloadable copy exists.</p>
  `;

  // Keep every legacy Find Music tool available, but collapse it below the focused flow.
  const legacyNodes = Array.from(content.children);
  const advanced = document.createElement('details');
  advanced.className = 'fm-import-advanced';
  advanced.innerHTML = '<summary>Advanced search and import tools</summary>';
  const advancedBody = document.createElement('div');
  advancedBody.className = 'fm-import-advanced-body';
  for (const node of legacyNodes) advancedBody.appendChild(node);
  advanced.appendChild(advancedBody);
  content.replaceChildren(section, advanced);

  const $ = (id) => document.getElementById(id);
  const linkInput = $('fmImportLink');
  const resolveButton = $('fmImportResolve');
  const csvButton = $('fmImportCsvButton');
  const csvInput = $('fmImportCsvFile');
  const statusEl = $('fmImportStatus');
  const candidateArea = $('fmImportCandidateArea');
  const progressWrap = $('fmImportProgressWrap');
  const progress = $('fmImportProgress');
  const progressText = $('fmImportProgressText');
  const progressNumber = $('fmImportProgressNumber');
  const cancelButton = $('fmImportCancel');
  const collectionArea = $('fmImportCollection');
  const collectionHeader = $('fmImportCollectionHeader');
  const statsEl = $('fmImportStats');
  const tracksEl = $('fmImportTracks');
  const downloadButton = $('fmImportDownload');
  const downloadSummary = $('fmImportDownloadSummary');
  const downloadHint = $('fmImportDownloadHint');
  const zipArea = $('fmImportZipArea');

  let generation = 0;
  let collection = null;
  let collectionRequestId = null;
  let busy = false;
  let currentFile = null;
  let pasteTimer = null;
  const statuses = new Map();
  const downloadRequestId = () => `fm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  function setStatus(message, kind = 'info') {
    statusEl.textContent = message || '';
    statusEl.className = `find-music-status${kind === 'success' ? ' find-music-status-ok' : kind === 'error' ? ' find-music-status-error' : ''}`;
  }
  function setBusy(value) {
    busy = Boolean(value);
    resolveButton.disabled = busy;
    csvButton.disabled = busy;
    resolveButton.textContent = busy ? 'Resolving…' : 'Resolve';
  }
  function showProgress(message, done = 0, total = 0) {
    progressWrap.hidden = false;
    progressText.textContent = message || 'Working…';
    progressNumber.textContent = total > 0 ? `${Math.max(0, Math.min(total, done))} / ${total}` : '';
    progress.value = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
  }
  function hideProgress() { progressWrap.hidden = true; progress.value = 0; progressNumber.textContent = ''; }
  function safeText(value) { return String(value == null ? '' : value); }
  function formatDuration(seconds) {
    if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return 'Duration unknown';
    const s = Math.round(Number(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function getLibraryTracks() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Sleeve did not respond with its current library. Restart Sleeve and try again.'));
      }, 2500);
      const callback = (tracks) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(Array.isArray(tracks) ? tracks : []);
      };
      window.dispatchEvent(new CustomEvent('sleeve:find-music-get-library', { detail: { callback } }));
    });
  }

  async function importDownloadedPath(filePath) {
    const record = await api.findMusicReadDownloadedFile(filePath);
    if (!record || !record.bytes || !record.name) throw new Error('Sleeve received an invalid downloaded audio file.');
    const bytes = record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes);
    const file = new File([bytes], record.name, { type: record.type || 'application/octet-stream', lastModified: Number(record.lastModified) || Date.now() });
    file.__sleeveSourcePath = record.path || filePath;
    window.dispatchEvent(new CustomEvent('sleeve:find-music-import-files', { detail: { files: [file] } }));
  }

  function clearCollection() {
    collection = null;
    currentFile = null;
    statuses.clear();
    collectionArea.hidden = true;
    collectionHeader.replaceChildren();
    statsEl.replaceChildren();
    tracksEl.replaceChildren();
    zipArea.hidden = true;
    zipArea.replaceChildren();
    downloadButton.disabled = true;
    downloadSummary.textContent = 'No missing tracks yet';
    downloadHint.textContent = 'Only eligible direct audio downloads will be included.';
    candidateArea.hidden = true;
    candidateArea.replaceChildren();
  }

  async function applyCollection(next, options = {}) {
    const localGeneration = generation;
    candidateArea.hidden = true;
    candidateArea.replaceChildren();
    if (!next || !Array.isArray(next.tracks) || !next.tracks.length) throw new Error('No tracks were returned for this collection.');
    if (next.tracks.length > core.MAX_TRACKS) throw new Error(`Sleeve currently supports up to ${core.MAX_TRACKS} tracks per import.`);
    showProgress('Checking your Sleeve library…', 0, next.tracks.length);
    const library = await getLibraryTracks();
    if (localGeneration !== generation) return;
    const owned = core.markAlreadyOwned(next.tracks, library);
    collection = {
      name: safeText(next.collectionName || (next.kind === 'track' ? next.tracks[0].title : 'Imported Playlist')).trim() || 'Imported Playlist',
      artist: safeText(next.artist || '').trim(),
      artworkUrl: /^https:\/\//i.test(next.artworkUrl || '') ? next.artworkUrl : '',
      referenceUrl: next.referenceUrl || '',
      kind: next.kind || 'playlist',
      tracks: owned
    };
    hideProgress();
    renderCollection();
    const have = owned.filter((t) => t.status === 'already-have').length;
    const duplicates = owned.filter((t) => t.status === 'duplicate-in-playlist').length;
    const missing = owned.filter((t) => t.status === 'missing').length;
    setStatus(`Loaded ${owned.length} tracks · ${have} already in your library · ${missing} missing${duplicates ? ` · ${duplicates} duplicate entries skipped` : ''}.`, 'success');
    if (options.autoDownload && missing > 0) setStatus('Metadata resolved. Review the missing-track count, then click Download Audio when ready.', 'success');
  }

  function renderCandidateChoices(result) {
    candidateArea.replaceChildren();
    candidateArea.hidden = false;
    const heading = make('div', 'fm-import-candidate-heading', result.kind === 'album' ? 'Choose the correct album' : 'Choose the correct recording');
    const explain = make('p', 'fm-import-candidate-explain', 'The public link preview does not identify the artist clearly enough to choose automatically. Pick the matching result to avoid a wrong version.');
    candidateArea.append(heading, explain);
    (result.candidates || []).forEach((candidate) => {
      const button = make('button', 'fm-import-candidate', '');
      button.type = 'button';
      if (candidate.artworkUrl) {
        const image = document.createElement('img');
        image.src = candidate.artworkUrl;
        image.alt = '';
        image.loading = 'lazy';
        button.appendChild(image);
      }
      const copy = make('span', 'fm-import-candidate-copy');
      copy.appendChild(make('strong', '', candidate.title || candidate.name || 'Unknown title'));
      copy.appendChild(make('small', '', [candidate.artist, candidate.album, candidate.trackCount ? `${candidate.trackCount} tracks` : ''].filter(Boolean).join(' · ')));
      button.appendChild(copy);
      button.addEventListener('click', async () => {
        const localGeneration = generation;
        try {
          setBusy(true);
          if (result.kind === 'album') {
            showProgress('Loading album track list…', 0, candidate.trackCount || 0);
            const fetched = await api.findMusicGetPublicAlbumTracks(candidate.collectionId);
            if (localGeneration !== generation) return;
            await applyCollection({ ...fetched, kind: 'album', artworkUrl: fetched.artworkUrl || candidate.artworkUrl, artist: fetched.artist || candidate.artist, referenceUrl: result.referenceUrl });
          } else {
            const track = {
              sourceIndex: 0, title: candidate.title, artist: candidate.artist, album: candidate.album,
              isrc: candidate.isrc || '', durationSec: candidate.durationSec || null, trackNumber: candidate.trackNumber || 1,
              collectionId: candidate.collectionId || null, albumUri: '', artworkUrl: candidate.artworkUrl || '', status: 'pending'
            };
            await applyCollection({ kind: 'track', collectionName: track.title, artist: track.artist, artworkUrl: track.artworkUrl, referenceUrl: result.referenceUrl, tracks: [track] });
          }
        } catch (error) {
          if (localGeneration === generation) setStatus(error && error.message || 'Could not load that public catalog match.', 'error');
        } finally {
          if (localGeneration === generation) { hideProgress(); setBusy(false); }
        }
      });
      candidateArea.appendChild(button);
    });
  }

  async function resolveLink() {
    const raw = linkInput.value.trim();
    if (!raw) { setStatus('Paste a Spotify link or YouTube video URL first, or import a playlist CSV.', 'error'); return; }
    const localGeneration = ++generation;
    clearCollection();
    setBusy(true);
    showProgress('Reading public link metadata…');
    setStatus('No Spotify account connection is needed. Resolving public metadata…');
    try {
      const result = await api.findMusicResolvePublicLink({ url: raw });
      if (localGeneration !== generation) return;
      if (result.requiresCsv) {
        hideProgress();
        setStatus(result.message || 'This is a playlist link. Import a CSV track list to load the songs without connecting a music account.', 'info');
        csvButton.classList.add('fm-import-attention');
        csvButton.focus();
        return;
      }
      if (result.ambiguous) {
        renderCandidateChoices(result);
        hideProgress();
        setStatus(result.message || 'Choose the matching public catalog result.', 'info');
        return;
      }
      if (result.kind === 'track' && result.track) {
        await applyCollection({
          kind: 'track', collectionName: result.track.title, artist: result.track.artist,
          artworkUrl: result.track.artworkUrl || result.thumbnailUrl, referenceUrl: result.referenceUrl,
          tracks: [{ ...result.track, sourceIndex: 0, status: 'pending' }]
        });
      } else if (result.kind === 'album' && result.collection) {
        await applyCollection({ ...result.collection, kind: 'album', artworkUrl: result.collection.artworkUrl || result.thumbnailUrl, referenceUrl: result.referenceUrl });
      }
      if (localGeneration === generation && result.message) setStatus(result.message, 'success');
    } catch (error) {
      if (localGeneration !== generation) return;
      hideProgress();
      setStatus(error && error.message || 'Could not resolve that link. Try an Exportify CSV or manual search.', 'error');
    } finally {
      if (localGeneration === generation) setBusy(false);
    }
  }

  async function importCsvFile(file) {
    if (!file) return;
    if (file.size > core.MAX_CSV_BYTES) { setStatus('CSV is larger than 10 MB. Export a smaller playlist and try again.', 'error'); csvInput.value = ''; return; }
    const localGeneration = ++generation;
    clearCollection();
    setBusy(true);
    showProgress('Reading playlist CSV…');
    try {
      const text = await file.text();
      if (localGeneration !== generation) return;
      const parsed = core.parseExportifyCsv(text, { fileName: file.name });
      linkInput.value = linkInput.value.trim();
      csvButton.classList.remove('fm-import-attention');
      await applyCollection({ ...parsed, kind: 'playlist', artist: '', referenceUrl: linkInput.value.trim() });
    } catch (error) {
      if (localGeneration === generation) {
        hideProgress();
        setStatus(error && error.message || 'Could not read the playlist CSV.', 'error');
      }
    } finally {
      if (localGeneration === generation) setBusy(false);
      csvInput.value = '';
    }
  }

  function countByStatus(status) { return collection ? collection.tracks.filter((t) => t.status === status).length : 0; }

  function renderCollection() {
    if (!collection) return;
    collectionArea.hidden = false;
    collectionHeader.replaceChildren();
    if (collection.artworkUrl) {
      const img = document.createElement('img');
      img.className = 'fm-import-cover';
      img.src = collection.artworkUrl;
      img.alt = '';
      img.loading = 'lazy';
      collectionHeader.appendChild(img);
    }
    const heading = make('div', 'fm-import-album-copy');
    heading.appendChild(make('h4', '', collection.name));
    if (collection.artist) heading.appendChild(make('p', '', collection.artist));
    heading.appendChild(make('span', 'fm-import-source-note', collection.kind === 'playlist' ? 'Imported playlist metadata' : collection.kind === 'album' ? 'Public album metadata' : 'Public track metadata'));
    collectionHeader.appendChild(heading);

    const owned = countByStatus('already-have');
    const duplicates = countByStatus('duplicate-in-playlist');
    const missing = collection.tracks.filter((track) => ['missing', 'not-found', 'error', 'cancelled'].includes(track.status)).length;
    const downloaded = countByStatus('downloaded');
    statsEl.replaceChildren();
    [[collection.tracks.length, 'tracks'], [owned, 'in library'], [missing, 'to download'], [duplicates, 'duplicates']].forEach(([number, label]) => {
      if (label === 'duplicates' && !number) return;
      const tile = make('div', 'fm-import-stat');
      tile.append(make('strong', '', number), make('span', '', label));
      statsEl.appendChild(tile);
    });

    tracksEl.replaceChildren();
    collection.tracks.forEach((track, index) => {
      const row = make('article', 'fm-import-track');
      row.dataset.sourceIndex = String(track.sourceIndex);
      const number = make('span', 'fm-import-track-number', String(index + 1).padStart(2, '0'));
      const text = make('div', 'fm-import-track-copy');
      text.appendChild(make('strong', '', track.title));
      text.appendChild(make('small', '', [track.artist, track.album, formatDuration(track.durationSec)].filter(Boolean).join(' · ')));
      const statusValue = statuses.get(track.sourceIndex) || track.status;
      const label = statusValue === 'already-have' ? 'In library'
        : statusValue === 'duplicate-in-playlist' ? 'Duplicate'
          : statusValue === 'downloaded' ? 'Downloaded'
            : statusValue === 'downloaded-not-zipped' ? 'Downloaded · no ZIP'
              : statusValue === 'not-found' ? 'Not found'
                : statusValue === 'error' ? 'Failed'
                  : statusValue === 'cancelled' ? 'Cancelled'
                    : statusValue === 'size-limit' ? 'ZIP size limit' : 'Missing';
      const badge = make('span', `fm-import-track-status fm-import-status-${statusValue}`, label);
      const actions = make('div', 'fm-import-track-actions');
      if (track.collectionId || track.albumUri) {
        const albumButton = make('button', 'find-music-text-button fm-import-album-button', 'Fetch Whole Album');
        albumButton.type = 'button';
        albumButton.addEventListener('click', () => fetchWholeAlbum(track));
        actions.appendChild(albumButton);
      }
      row.append(number, text, badge, actions);
      tracksEl.appendChild(row);
    });

    const retryableCount = missing;
    downloadSummary.textContent = `${retryableCount} track${retryableCount === 1 ? '' : 's'} ready to download`;
    downloadHint.textContent = owned + duplicates > 0
      ? `${owned} already in your library and ${duplicates} duplicate playlist entries will be skipped.`
      : 'Only high-confidence matches with supported direct-download and license information will be included.';
    downloadButton.disabled = retryableCount === 0 || Boolean(collectionRequestId);
    downloadButton.innerHTML = collectionRequestId ? '<span aria-hidden="true">◌</span> Downloading…' : '<span aria-hidden="true">↓</span> Download Audio';
  }

  async function fetchWholeAlbum(track) {
    const localGeneration = ++generation;
    setBusy(true);
    showProgress('Resolving the album…');
    try {
      if (track.collectionId) {
        const result = await api.findMusicGetPublicAlbumTracks(track.collectionId);
        if (localGeneration !== generation) return;
        await applyCollection({ ...result, kind: 'album', artworkUrl: track.artworkUrl, referenceUrl: track.albumUri || '' });
      } else if (track.albumUri) {
        linkInput.value = spotifyUriToHttps(track.albumUri);
        await resolveLink();
      } else {
        throw new Error('This track does not include a public album identifier.');
      }
    } catch (error) {
      if (localGeneration === generation) { hideProgress(); setStatus(error && error.message || 'Could not resolve this album.', 'error'); }
    } finally {
      if (localGeneration === generation) setBusy(false);
    }
  }

  function spotifyUriToHttps(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^spotify:album:([A-Za-z0-9]{10,64})$/i);
    if (match) return `https://open.spotify.com/album/${match[1]}`;
    return raw;
  }

  async function downloadMissing() {
    if (!collection || collectionRequestId) return;
    const retryableStatuses = new Set(['missing', 'not-found', 'error', 'cancelled']);
    const missing = collection.tracks.filter((track) => retryableStatuses.has(track.status));
    if (!missing.length) { setStatus('Everything in this collection is already in your library, or there are no eligible missing entries.', 'info'); return; }
    const requestId = downloadRequestId();
    const localGeneration = generation;
    collectionRequestId = requestId;
    setBusy(true);
    renderCollection();
    showProgress('Preparing audio matches…', 0, missing.length);
    setStatus(`Resolving and downloading ${missing.length} missing track${missing.length === 1 ? '' : 's'}…`);
    try {
      const result = await api.findMusicDownloadOpenAudioCollection({
        requestId,
        collectionName: collection.name,
        tracks: missing.map((track) => ({
          sourceIndex: track.sourceIndex,
          title: track.title,
          artist: track.artist,
          album: track.album,
          isrc: track.isrc,
          durationSec: track.durationSec
        }))
      });
      if (localGeneration !== generation || collectionRequestId !== requestId) return;
      let imported = 0;
      for (const item of result.results || []) {
        statuses.set(item.index, item.status);
        if (item.path && ['downloaded', 'downloaded-not-zipped'].includes(item.status)) {
          try {
            await importDownloadedPath(item.path);
            imported += 1;
          } catch (error) {
            statuses.set(item.index, 'error');
          }
        }
      }
      collection.tracks = collection.tracks.map((track) => {
        const state = statuses.get(track.sourceIndex);
        if (!state) return track;
        return { ...track, status: state, message: (result.results || []).find((item) => item.index === track.sourceIndex)?.message || track.message };
      });
      renderCollection();
      if (result.zipPath) {
        zipArea.replaceChildren();
        zipArea.hidden = false;
        zipArea.appendChild(make('strong', '', `${result.packagedCount} tracks packaged into ${result.zipName}`));
        zipArea.appendChild(make('span', '', `${formatBytes(result.zipSize)} · saved in Music/Sleeve Downloads`));
        const reveal = make('button', 'find-music-secondary', 'Show ZIP in folder');
        reveal.type = 'button';
        reveal.addEventListener('click', () => {
          if (typeof api.showItemInFolder === 'function') api.showItemInFolder(result.zipPath);
          else setStatus(`ZIP saved at: ${result.zipPath}`, 'info');
        });
        zipArea.appendChild(reveal);
      }
      setStatus(`${result.note || 'Download finished.'}${imported ? ` Imported ${imported} file${imported === 1 ? '' : 's'} into your library.` : ''}`, result.downloadedCount ? 'success' : 'info');
    } catch (error) {
      if (localGeneration === generation) setStatus(error && error.message || 'The download job failed.', 'error');
    } finally {
      if (collectionRequestId === requestId) collectionRequestId = null;
      if (localGeneration === generation) {
        hideProgress();
        setBusy(false);
        renderCollection();
      }
    }
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  function reset() {
    generation += 1;
    if (collectionRequestId) api.findMusicCancelOpenAudioCollection(collectionRequestId).catch(() => {});
    collectionRequestId = null;
    clearCollection();
    linkInput.value = '';
    csvInput.value = '';
    csvButton.classList.remove('fm-import-attention');
    setBusy(false);
    hideProgress();
    setStatus('Ready. Paste a Spotify track/album or YouTube video link, or import a playlist CSV.');
    if (pasteTimer) window.clearTimeout(pasteTimer);
    pasteTimer = null;
  }

  resolveButton.addEventListener('click', resolveLink);
  linkInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') resolveLink(); });
  linkInput.addEventListener('paste', () => {
    if (pasteTimer) window.clearTimeout(pasteTimer);
    pasteTimer = window.setTimeout(() => {
      if (/spotify(?:\.com\/|:)(?:track|album|playlist)/i.test(linkInput.value.trim()) || /(?:youtube\.com\/(?:watch|shorts|embed|live|playlist)|youtu\.be\/)/i.test(linkInput.value.trim())) resolveLink();
    }, 80);
  });
  csvButton.addEventListener('click', () => csvInput.click());
  csvInput.addEventListener('change', () => importCsvFile(csvInput.files && csvInput.files[0]));
  downloadButton.addEventListener('click', downloadMissing);
  cancelButton.addEventListener('click', () => {
    generation += 1;
    if (collectionRequestId) api.findMusicCancelOpenAudioCollection(collectionRequestId).catch(() => {});
    collectionRequestId = null;
    hideProgress();
    setBusy(false);
    renderCollection();
    setStatus('The current operation was cancelled where possible. Any completed downloads remain in Sleeve Downloads.', 'info');
  });
  if (typeof api.findMusicOnOpenAudioCollectionProgress === 'function') {
    api.findMusicOnOpenAudioCollectionProgress((payload) => {
      if (!payload || payload.requestId !== collectionRequestId) return;
      showProgress(payload.message || 'Downloading…', payload.processed, payload.total);
    });
  }
  document.addEventListener('sleeve:find-music-reset', reset);
})();

/* ===== END find-music-import-ui.js ===== */

/* ===== BEGIN find-music-convert-ui.js ===== */
/* Sleeve Find Music: local media conversion with FFmpeg.
 * Link URLs are used for identification/reference only. The converter accepts
 * a user-selected local media file; it does not extract YouTube streams. */
(() => {
  'use strict';
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('fmConvertCard')) return;

  const api = window.electronAPI;
  const parent = document.getElementById('fmImportWorkflow');
  if (!api || !parent || typeof api.findMusicConvertPickSource !== 'function' ||
      typeof api.findMusicConvertRun !== 'function') {
    console.warn('[Sleeve Find Music] Local media converter is unavailable. Re-run the current installer.');
    return;
  }

  const card = document.createElement('section');
  card.id = 'fmConvertCard';
  card.className = 'find-music-card fm-convert-card';
  card.innerHTML = `
    <div class="fm-convert-head">
      <div class="fm-convert-icon" aria-hidden="true"><span></span><span></span></div>
      <div><span class="fm-import-eyebrow">LOCAL MEDIA TOOLS</span><h3>Make an MP3 or MP4</h3>
      <p>Use a media file you own or are authorized to convert. Paste a Spotify link above to identify a track, or a YouTube URL to identify a video.</p></div>
    </div>
    <div class="fm-convert-reference-row">
      <button id="fmConvertFindVideo" class="find-music-secondary" type="button">Find YouTube reference</button>
      <span class="fm-convert-muted">Opens the regular browser only when clicked.</span>
    </div>
    <div class="fm-convert-source-row">
      <button id="fmConvertPickSource" class="find-music-secondary" type="button">Choose media file…</button>
      <div class="fm-convert-source-info"><strong id="fmConvertSourceName">No file selected</strong><span id="fmConvertSourceDetails">Choose an audio or video file from your computer.</span></div>
    </div>
    <div class="fm-convert-actions">
      <label class="fm-convert-format-wrap" for="fmConvertFormat"><span>Output format</span>
        <select id="fmConvertFormat"><option value="mp3">MP3 · audio only</option><option value="mp4">MP4 · video</option></select>
      </label>
      <button id="fmConvertRun" class="fm-import-download-button" type="button" disabled>Convert &amp; Import</button>
    </div>
    <div class="fm-convert-ffmpeg-row"><span id="fmConvertFfmpegStatus" role="status">Checking FFmpeg…</span><button id="fmConvertPickFfmpeg" class="find-music-text-button" type="button">Locate FFmpeg</button></div>
    <div id="fmConvertProgressWrap" class="fm-import-progress" hidden>
      <div class="fm-import-progress-label"><span id="fmConvertProgressText">Converting…</span><span id="fmConvertProgressNumber"></span></div>
      <progress id="fmConvertProgress" max="100" value="0"></progress>
      <button id="fmConvertCancel" class="find-music-text-button" type="button">Cancel conversion</button>
    </div>
    <div id="fmConvertStatus" class="find-music-status" role="status" aria-live="polite">Ready. Select a media file to convert it locally.</div>
    <p class="fm-convert-footnote">A Spotify or YouTube URL identifies media; it is not itself a local media file. Sleeve does not extract streams from YouTube. For a video you uploaded, use YouTube Studio’s official download, then select that MP4 here. Large outputs are saved to Music/Sleeve Converted and can be revealed in Explorer.</p>
  `;
  parent.after(card);

  const $ = (id) => document.getElementById(id);
  const linkInput = $('fmImportLink');
  const pickSourceButton = $('fmConvertPickSource');
  const sourceName = $('fmConvertSourceName');
  const sourceDetails = $('fmConvertSourceDetails');
  const formatSelect = $('fmConvertFormat');
  const runButton = $('fmConvertRun');
  const pickFfmpegButton = $('fmConvertPickFfmpeg');
  const ffmpegStatus = $('fmConvertFfmpegStatus');
  const status = $('fmConvertStatus');
  const progressWrap = $('fmConvertProgressWrap');
  const progress = $('fmConvertProgress');
  const progressText = $('fmConvertProgressText');
  const progressNumber = $('fmConvertProgressNumber');
  const cancelButton = $('fmConvertCancel');
  const findVideoButton = $('fmConvertFindVideo');

  let selectedSource = null;
  let currentJobId = null;
  let busy = false;
  let ffmpegAvailable = false;

  function setStatus(message, kind = 'info') {
    status.textContent = message || '';
    status.className = `find-music-status${kind === 'success' ? ' find-music-status-ok' : kind === 'error' ? ' find-music-status-error' : ''}`;
  }
  function setBusy(value) {
    busy = Boolean(value);
    pickSourceButton.disabled = busy;
    pickFfmpegButton.disabled = busy;
    findVideoButton.disabled = busy;
    formatSelect.disabled = busy;
    runButton.disabled = busy || !selectedSource || !ffmpegAvailable;
  }
  function setProgress(message, percent) {
    progressWrap.hidden = false;
    progressText.textContent = message || 'Converting…';
    if (Number.isFinite(percent)) {
      progress.value = Math.max(0, Math.min(100, percent));
      progress.removeAttribute('data-indeterminate');
      progressNumber.textContent = `${Math.round(progress.value)}%`;
    } else {
      progress.value = 0;
      progress.setAttribute('data-indeterminate', 'true');
      progressNumber.textContent = '';
    }
  }
  function hideProgress() {
    progressWrap.hidden = true;
    progress.value = 0;
    progress.removeAttribute('data-indeterminate');
    progressNumber.textContent = '';
  }
  function formatBytes(value) {
    const n = Number(value) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  async function refreshFfmpegStatus() {
    try {
      const result = await api.findMusicConvertStatus();
      ffmpegStatus.textContent = result && result.message || 'FFmpeg status unavailable.';
      ffmpegAvailable = Boolean(result && result.available);
      ffmpegStatus.classList.toggle('is-ready', ffmpegAvailable);
      ffmpegStatus.classList.toggle('is-missing', !ffmpegAvailable);
      if (!ffmpegAvailable) setStatus('FFmpeg is required for conversion. Install it or use Locate FFmpeg to select its executable.');
      refreshActions();
    } catch (error) {
      ffmpegStatus.textContent = 'Could not check FFmpeg.';
      ffmpegStatus.classList.add('is-missing');
      setStatus(error && error.message || 'Could not check FFmpeg.', 'error');
    }
  }
  function videoLikeSource() { return Boolean(selectedSource && selectedSource.kind === 'video'); }
  function refreshActions() {
    const mp4 = formatSelect.value === 'mp4';
    const mp4Option = formatSelect.querySelector('option[value="mp4"]');
    if (mp4Option) mp4Option.disabled = Boolean(selectedSource && selectedSource.kind !== 'video');
    if (mp4 && selectedSource && selectedSource.kind !== 'video') formatSelect.value = 'mp3';
    runButton.disabled = busy || !selectedSource || !ffmpegAvailable;
  }

  pickSourceButton.addEventListener('click', async () => {
    try {
      const result = await api.findMusicConvertPickSource();
      if (!result || result.cancelled) return;
      selectedSource = result;
      sourceName.textContent = result.name;
      sourceDetails.textContent = `${formatBytes(result.size)} · ${result.kind === 'video' ? 'Video/audio source' : 'Audio source'}`;
      formatSelect.value = result.kind === 'video' ? 'mp3' : 'mp3';
      refreshActions();
      setStatus(result.kind === 'video'
        ? 'Video selected. Choose MP3 to extract its audio, or MP4 to convert the video.'
        : 'Audio selected. MP3 output is available; MP4 requires a video source.');
    } catch (error) { setStatus(error && error.message || 'Could not select that media file.', 'error'); }
  });

  pickFfmpegButton.addEventListener('click', async () => {
    try {
      const result = await api.findMusicConvertPickFfmpeg();
      if (!result || result.cancelled) return;
      ffmpegAvailable = true;
      ffmpegStatus.textContent = result.message || 'FFmpeg ready.';
      ffmpegStatus.classList.add('is-ready');
      ffmpegStatus.classList.remove('is-missing');
      refreshActions();
      setStatus('FFmpeg is configured. Select a media file and click Convert & Import.');
    } catch (error) { setStatus(error && error.message || 'Could not configure FFmpeg.', 'error'); }
  });

  formatSelect.addEventListener('change', () => {
    refreshActions();
    if (formatSelect.value === 'mp4' && selectedSource && selectedSource.kind !== 'video') setStatus('MP4 output requires a video file. Choose a video, or select MP3 to extract audio.');
  });

  findVideoButton.addEventListener('click', async () => {
    const raw = String(linkInput && linkInput.value || '').trim();
    if (!raw) { setStatus('Paste a Spotify track/album link or YouTube video URL above first.', 'error'); return; }
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
        await api.findMusicOpenUrl(parsed.href);
        setStatus('Opened the YouTube video in your normal browser. To convert it, select a media file you are allowed to use.', 'success');
        return;
      }
    } catch (_) {}
    try {
      setBusy(true);
      setStatus('Reading the Spotify link to build a YouTube reference search…');
      const result = await api.findMusicResolvePublicLink({ url: raw });
      let query = '';
      if (result && result.track) query = [result.track.title, result.track.artist, 'official audio'].filter(Boolean).join(' ');
      else if (result && result.collection) {
        const first = (result.collection.tracks || [])[0];
        query = [result.collection.name, result.collection.artist || (first && first.artist), 'official audio'].filter(Boolean).join(' ');
      } else if (result && Array.isArray(result.candidates) && result.candidates.length) {
        const first = result.candidates[0];
        query = [first.title, first.artist, 'official audio'].filter(Boolean).join(' ');
      }
      if (!query) throw new Error(result && result.message || 'Sleeve could not build a track search from this link. Import an Exportify CSV for playlists.');
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      await api.findMusicOpenUrl(searchUrl);
      setStatus('Opened a YouTube search for the identified recording in your normal browser. This is a reference only; the URL is not downloaded by Sleeve.', 'success');
    } catch (error) {
      setStatus(error && error.message || 'Could not create a YouTube reference search.', 'error');
    } finally { setBusy(false); }
  });

  runButton.addEventListener('click', async () => {
    if (!selectedSource || busy) return;
    if (formatSelect.value === 'mp4' && !videoLikeSource()) {
      setStatus('MP4 output requires a video source. Choose a video or select MP3.', 'error');
      return;
    }
    currentJobId = `convert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const jobId = currentJobId;
    setBusy(true);
    setProgress('Starting FFmpeg…', 0);
    setStatus('Converting your selected media locally…');
    try {
      const result = await api.findMusicConvertRun({ selectionToken: selectedSource.selectionToken, format: formatSelect.value, jobId });
      if (currentJobId !== jobId) return;
      hideProgress();
      if (result.autoImport) {
        const record = await api.findMusicConvertReadOutput(result.outputToken);
        if (!record || !record.bytes || !record.name) throw new Error('The converted output could not be read for library import.');
        const bytes = record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes);
        const file = new File([bytes], record.name, { type: record.type || 'application/octet-stream', lastModified: Number(record.lastModified) || Date.now() });
        file.__sleeveSourcePath = record.path;
        window.dispatchEvent(new CustomEvent('sleeve:find-music-import-files', { detail: { files: [file] } }));
        setStatus(`Converted ${result.name} (${formatBytes(result.size)}) and added it to Sleeve. Saved in Music/Sleeve Converted.`, 'success');
      } else {
        setStatus(`Converted ${result.name} (${formatBytes(result.size)}). It exceeds the 300 MB auto-import limit, so it was saved to Music/Sleeve Converted. Click Show file to reveal it.`, 'success');
      }
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.className = 'find-music-secondary fm-convert-reveal';
      reveal.textContent = 'Show file';
      reveal.addEventListener('click', async () => {
        try { await api.findMusicConvertRevealOutput(result.outputToken); }
        catch (error) { setStatus(error && error.message || 'Could not reveal the converted file.', 'error'); }
      });
      status.appendChild(document.createTextNode(' '));
      status.appendChild(reveal);
    } catch (error) {
      if (currentJobId === jobId) {
        hideProgress();
        setStatus(error && error.message || 'Conversion failed. Check FFmpeg and the selected file.', 'error');
      }
    } finally {
      if (currentJobId === jobId) currentJobId = null;
      setBusy(false);
      refreshActions();
    }
  });

  cancelButton.addEventListener('click', async () => {
    if (!currentJobId) return;
    const job = currentJobId;
    try { await api.findMusicConvertCancel(job); } catch (_) {}
    setStatus('Cancellation requested. Any partial output will be removed.');
  });

  if (typeof api.findMusicConvertOnProgress === 'function') {
    api.findMusicConvertOnProgress((payload) => {
      if (!payload || payload.jobId !== currentJobId) return;
      setProgress(payload.message || 'Converting…', payload.percent);
      if (payload.stage === 'complete') setProgress('Finishing…', 100);
    });
  }

  document.addEventListener('sleeve:find-music-reset', async () => {
    if (currentJobId) {
      const job = currentJobId;
      currentJobId = null;
      try { await api.findMusicConvertCancel(job); } catch (_) {}
    }
    selectedSource = null;
    sourceName.textContent = 'No file selected';
    sourceDetails.textContent = 'Choose an audio or video file from your computer.';
    formatSelect.value = 'mp3';
    setBusy(false);
    refreshActions();
    hideProgress();
    setStatus('Ready. Select a media file to convert it locally.');
  });

  refreshFfmpegStatus();
  refreshActions();
})();

/* ===== END find-music-convert-ui.js ===== */
