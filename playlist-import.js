(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const DB_NAME = 'sleeveDB';
  const TRACK_STORE = 'tracks';
  const PLAYLIST_STORE = 'playlists';
  const AUDIO_EXTENSIONS = new Set([
    'aac', 'aif', 'aiff', 'alac', 'flac', 'm4a', 'mp3', 'oga', 'ogg',
    'opus', 'wav', 'wave', 'wma', 'caf', 'ape', 'wv', 'mp4', 'm4b'
  ]);

  function normalizeHeader(value) {
    return String(value == null ? '' : value)
      .replace(/^\uFEFF/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  // Small RFC-4180-style parser: quoted commas, escaped quotes, and CRLF are supported.
  function parseCsv(text) {
    if (typeof text !== 'string') throw new TypeError('The CSV contents must be text.');
    const source = text.replace(/^\uFEFF/, '');
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (quoted) {
        if (char === '"') {
          if (source[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (char === ',') {
        record.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[i + 1] === '\n') i += 1;
        record.push(field);
        if (record.some((cell) => String(cell).trim() !== '')) records.push(record);
        record = [];
        field = '';
      } else {
        field += char;
      }
    }

    if (quoted) throw new Error('This CSV has an unfinished quoted field. Export it again as CSV and retry.');
    if (field.length || record.length) {
      record.push(field);
      if (record.some((cell) => String(cell).trim() !== '')) records.push(record);
    }
    if (records.length < 2) throw new Error('The CSV does not contain any playlist tracks.');

    const headers = records[0].map((header) => normalizeHeader(header));
    const findColumn = (aliases) => headers.findIndex((header) => aliases.includes(header));
    const titleIndex = findColumn(['trackname', 'tracktitle', 'songname', 'track', 'title', 'name']);
    const artistIndex = findColumn(['artistnames', 'artistname', 'artists', 'artist']);
    const albumIndex = findColumn(['albumname', 'album']);

    if (titleIndex < 0) {
      throw new Error('I could not find a Track Name column. Use the CSV exported by Exportify, not a screenshot or copied webpage.');
    }

    const tracks = [];
    for (let i = 1; i < records.length; i += 1) {
      const cells = records[i];
      const title = String(cells[titleIndex] || '').trim();
      if (!title) continue;
      tracks.push({
        title,
        artist: artistIndex >= 0 ? String(cells[artistIndex] || '').trim() : '',
        album: albumIndex >= 0 ? String(cells[albumIndex] || '').trim() : '',
        rowNumber: i + 1
      });
    }
    if (!tracks.length) throw new Error('No rows with track names were found in this CSV.');
    return tracks;
  }

  function basename(filePath) {
    const cleaned = String(filePath == null ? '' : filePath).replace(/\\/g, '/');
    return cleaned.slice(cleaned.lastIndexOf('/') + 1);
  }

  function removeKnownExtension(value) {
    const match = String(value).match(/\.([a-z0-9]{2,5})$/i);
    if (match && AUDIO_EXTENSIONS.has(match[1].toLowerCase())) {
      return String(value).slice(0, -match[0].length);
    }
    return String(value);
  }

  function normalizeMusicKey(value) {
    return String(value == null ? '' : value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function normalizeTitleText(value) {
    let stem = removeKnownExtension(String(value == null ? '' : value)).trim();

    // Ignore common clean-edition tags in either parentheses or square brackets.
    stem = stem.replace(/\s*\(\s*clean\s*\)\s*/gi, ' ');
    stem = stem.replace(/\s*\[\s*clean\s*\]\s*/gi, ' ');

    // Ignore a leading release year, e.g. (1999) or (2013), before the track number.
    stem = stem.replace(/^\s*\(\s*(?:19|20)\d{2}\s*\)\s*/, '');

    // Covers 02-fake it, 02 - fake it, 02_fake it, 02.fake it, and 02 (sic).
    stem = stem.replace(/^\s*(?:(?:track|disc|disk|cd)\s*)?\d{1,3}\s*(?:[-_.:–—)]\s*|\s+)/i, '');
    return normalizeMusicKey(stem);
  }

  function normalizeTrackTitle(value) {
    return normalizeTitleText(basename(value));
  }

  function splitArtistNames(artist) {
    const whole = normalizeMusicKey(artist);
    const pieces = String(artist || '')
      .split(/\s*,\s*/)
      .map(normalizeMusicKey)
      .filter(Boolean);
    if (whole) pieces.unshift(whole);
    return [...new Set(pieces)];
  }

  function trackTitleKeys(track) {
    const keys = new Set();
    if (track && track.title) {
      const metadataKey = normalizeMusicKey(track.title);
      if (metadataKey) keys.add(metadataKey);
      const strippedKey = normalizeTitleText(track.title);
      if (strippedKey) keys.add(strippedKey);
    }
    const pathCandidates = [
      track && track.sourcePath,
      track && track.file && track.file.name,
      track && track.filename,
      track && track.path
    ];
    pathCandidates.forEach((candidate) => {
      const key = normalizeTrackTitle(candidate);
      if (key) keys.add(key);
    });
    return keys;
  }

  function scoreTrackMatch(row, track) {
    const rowTitle = normalizeTitleText(row.title);
    if (!rowTitle) return null;
    const metadataTitle = normalizeTitleText(track && track.title);
    const fileTitleKeys = trackTitleKeys(track);
    const titleMatchesMetadata = metadataTitle === rowTitle;
    const titleMatchesFilename = fileTitleKeys.has(rowTitle);
    if (!titleMatchesMetadata && !titleMatchesFilename) return null;

    let score = titleMatchesMetadata ? 100 : 85;
    const rowArtist = normalizeMusicKey(row.artist);
    const trackArtist = normalizeMusicKey(track && track.artist);
    let artistMatch = false;
    let artistConflict = false;
    if (rowArtist && trackArtist) {
      const acceptableArtistKeys = splitArtistNames(row.artist);
      artistMatch = acceptableArtistKeys.some((candidate) => candidate === trackArtist)
        || rowArtist === trackArtist;
      artistConflict = !artistMatch;
      score += artistMatch ? 40 : -50;
    }

    const rowAlbum = normalizeMusicKey(row.album);
    const trackAlbum = normalizeMusicKey(track && track.album);
    if (rowAlbum && trackAlbum && rowAlbum === trackAlbum) score += 15;

    return { track, score, artistMatch, artistConflict, titleMatchesMetadata, titleMatchesFilename };
  }

  function matchPlaylistRows(csvRows, libraryTracks) {
    const safeLibrary = (Array.isArray(libraryTracks) ? libraryTracks : [])
      .filter((track) => track && track.kind !== 'video' && track.id != null);

    return (Array.isArray(csvRows) ? csvRows : []).map((row) => {
      const candidates = safeLibrary
        .map((track) => scoreTrackMatch(row, track))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || String(a.track.title || '').localeCompare(String(b.track.title || '')));
      if (!candidates.length) return { row, candidates: [], match: null, status: 'missing' };

      const top = candidates[0];
      const second = candidates[1];
      const uniqueTopScore = !second || top.score > second.score;
      const artistIsSafe = !normalizeMusicKey(row.artist) || top.artistMatch;
      // Without artist metadata, only auto-match a single title candidate. This avoids
      // silently selecting the wrong version when two songs share a title.
      const titleIsSafe = normalizeMusicKey(row.artist) ? artistIsSafe : candidates.length === 1;
      const confidenceIsHigh = top.titleMatchesMetadata || top.titleMatchesFilename;
      const autoMatch = uniqueTopScore && titleIsSafe && confidenceIsHigh && top.score >= 85;

      return {
        row,
        candidates,
        match: autoMatch ? top.track : null,
        status: autoMatch ? 'matched' : 'review'
      };
    });
  }

  function getTrackLabel(track) {
    const fileName = basename(track && (track.sourcePath || (track.file && track.file.name) || track.filename || ''));
    const title = String(track && track.title || normalizeTrackTitle(fileName) || 'Untitled track').trim();
    const artist = String(track && track.artist || 'Unknown Artist').trim();
    const source = fileName && fileName.toLowerCase() !== title.toLowerCase() ? ` · ${fileName}` : '';
    return `${title} — ${artist}${source}`;
  }

  // Search all useful local-library fields, not only the metadata title. This
  // gives people a reliable manual fallback when automatic matching misses.
  function filterLibraryTracks(query, libraryTracks) {
    const tokens = normalizeMusicKey(query).split(' ').filter(Boolean);
    const safeLibrary = (Array.isArray(libraryTracks) ? libraryTracks : [])
      .filter((track) => track && track.kind !== 'video' && track.id != null);

    return safeLibrary
      .filter((track) => {
        if (!tokens.length) return true;
        const searchableText = normalizeMusicKey([
          track.title,
          track.artist,
          track.album,
          track.sourcePath,
          track.file && track.file.name,
          track.filename,
          track.path
        ].filter(Boolean).join(' '));
        return tokens.every((token) => searchableText.includes(token));
      })
      .sort((a, b) => getTrackLabel(a).localeCompare(getTrackLabel(b)));
  }

  function openDatabase(root) {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('Browser storage is unavailable, so Sleeve cannot read your local library.'));
        return;
      }
      let request;
      try {
        request = root.indexedDB.open(DB_NAME);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TRACK_STORE)) db.createObjectStore(TRACK_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(PLAYLIST_STORE)) db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('albumArt')) db.createObjectStore('albumArt', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('artistArt')) db.createObjectStore('artistArt', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Sleeve could not open its local library database.'));
      request.onblocked = () => reject(new Error('Sleeve storage is busy. Close other Sleeve windows and try again.'));
    });
  }

  async function readLibrary(root) {
    const db = await openDatabase(root);
    try {
      if (!db.objectStoreNames.contains(TRACK_STORE) || !db.objectStoreNames.contains(PLAYLIST_STORE)) {
        throw new Error('Sleeve’s local library database is missing its track or playlist store.');
      }
      return await new Promise((resolve, reject) => {
        const tx = db.transaction([TRACK_STORE, PLAYLIST_STORE], 'readonly');
        const tracksRequest = tx.objectStore(TRACK_STORE).getAll();
        const playlistsRequest = tx.objectStore(PLAYLIST_STORE).getAll();
        let tracks = [];
        let playlists = [];
        tracksRequest.onsuccess = () => { tracks = tracksRequest.result || []; };
        playlistsRequest.onsuccess = () => { playlists = playlistsRequest.result || []; };
        tx.oncomplete = () => resolve({ tracks, playlists });
        tx.onerror = () => reject(tx.error || new Error('Sleeve could not read the local library.'));
        tx.onabort = () => reject(tx.error || new Error('Reading the local library was cancelled.'));
      });
    } finally {
      db.close();
    }
  }

  async function saveImportedPlaylist(root, playlistName, trackIds) {
    const cleanIds = Array.isArray(trackIds) ? trackIds.filter((id) => id != null) : [];
    if (!cleanIds.length) throw new Error('Choose at least one local song before creating the playlist.');
    const cleanName = String(playlistName || '').trim();
    if (!cleanName) throw new Error('Enter a name for the playlist.');

    const db = await openDatabase(root);
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(PLAYLIST_STORE, 'readwrite');
        const store = tx.objectStore(PLAYLIST_STORE);
        const readRequest = store.getAll();
        let savedRecord = null;
        readRequest.onsuccess = () => {
          const existing = readRequest.result || [];
          const names = new Set(existing.map((item) => String(item.name || '').trim().toLocaleLowerCase()));
          let finalName = cleanName;
          let suffix = 2;
          while (names.has(finalName.toLocaleLowerCase())) {
            finalName = `${cleanName} (${suffix})`;
            suffix += 1;
          }
          const numericIds = existing.map((item) => Number(item.id)).filter(Number.isFinite);
          const nextId = numericIds.reduce((maxId, id) => Math.max(maxId, id), 0) + 1;
          savedRecord = { id: nextId, name: finalName, type: 'music', trackIds: cleanIds, thumb: null };
          store.put(savedRecord);
        };
        tx.oncomplete = () => resolve(savedRecord);
        tx.onerror = () => reject(tx.error || new Error('Sleeve could not save the imported playlist.'));
        tx.onabort = () => reject(tx.error || new Error('Saving the playlist was cancelled.'));
      });
    } finally {
      db.close();
    }
  }

  function makeElement(document, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function install(root) {
    if (!root || !root.document || root.location.search.includes('mini=1')) return;
    const document = root.document;
    if (document.getElementById('sleeveExportifyImportButton')) return;

    const actions = document.querySelector('.playlist-section-actions');
    if (!actions) return;

    if (!document.getElementById('sleeveExportifyImportStyles')) {
      const stylesheet = document.createElement('link');
      stylesheet.id = 'sleeveExportifyImportStyles';
      stylesheet.rel = 'stylesheet';
      stylesheet.href = './playlist-import.css';
      document.head.appendChild(stylesheet);
    }

    const trigger = makeElement(document, 'button', 'sp-import-trigger');
    trigger.id = 'sleeveExportifyImportButton';
    trigger.type = 'button';
    trigger.title = 'Import a Spotify / Exportify playlist CSV';
    trigger.setAttribute('aria-label', 'Import a Spotify or Exportify playlist');
    trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>';
    const newPlaylistButton = document.getElementById('newMusicPlaylistBtn');
    if (newPlaylistButton && newPlaylistButton.parentElement === actions) actions.insertBefore(trigger, newPlaylistButton);
    else actions.appendChild(trigger);
    trigger.addEventListener('click', () => openImportDialog(root));
  }

  function openImportDialog(root) {
    const document = root.document;
    if (document.querySelector('.sp-import-backdrop')) return;

    const backdrop = makeElement(document, 'div', 'sp-import-backdrop');
    backdrop.innerHTML = `
      <section class="sp-import-dialog" role="dialog" aria-modal="true" aria-labelledby="spImportTitle">
        <header class="sp-import-header">
          <div class="sp-import-heading">
            <span class="sp-import-eyebrow">PLAYLIST TOOLS</span>
            <h2 id="spImportTitle">Import a playlist</h2>
            <p>Bring an Exportify CSV into Sleeve using songs already in your library.</p>
          </div>
          <button class="sp-import-close" type="button" data-action="close" aria-label="Close import dialog">×</button>
        </header>
        <div class="sp-import-error" data-role="error" hidden></div>
        <section class="sp-import-start" data-role="start">
          <label class="sp-import-dropzone" for="spImportCsvFile">
            <span class="sp-import-upload-icon" aria-hidden="true">↑</span>
            <strong>Choose Exportify CSV</strong>
            <span>CSV file · Track titles and artists are read locally</span>
            <input id="spImportCsvFile" type="file" accept=".csv,text/csv" />
          </label>
          <div class="sp-import-note"><strong>Before you import</strong><span>The songs must already be added to Sleeve as regular local audio files. Spotify’s protected offline downloads are not audio files Sleeve can play.</span></div>
          <p class="sp-import-help">Export the playlist from Exportify, then select its downloaded .csv file here.</p>
        </section>
        <section class="sp-import-preview" data-role="preview" hidden>
          <div class="sp-import-summary" data-role="summary"></div>
          <label class="sp-import-name-label" for="spImportPlaylistName">Playlist name</label>
          <input class="sp-import-name" id="spImportPlaylistName" maxlength="200" type="text" autocomplete="off" />
          <div class="sp-import-list-heading"><span>Tracks in CSV order</span><span data-role="list-count"></span></div>
          <div class="sp-import-track-list" data-role="track-list"></div>
          <p class="sp-import-footnote">Unmatched tracks can be selected manually or left as “Skip this track.” Repeated songs in the CSV keep their original positions.</p>
          <div class="sp-import-actions">
            <button class="sp-import-button sp-import-button-secondary" type="button" data-action="back">Choose another CSV</button>
            <button class="sp-import-button sp-import-button-primary" type="button" data-action="save" disabled>Create playlist</button>
          </div>
        </section>
        <section class="sp-import-complete" data-role="complete" hidden>
          <span class="sp-import-complete-icon" aria-hidden="true">✓</span>
          <h3>Playlist saved</h3>
          <p data-role="complete-message"></p>
          <div class="sp-import-actions">
            <button class="sp-import-button sp-import-button-secondary" type="button" data-action="close">Done for now</button>
            <button class="sp-import-button sp-import-button-primary" type="button" data-action="reload">Reload Sleeve</button>
          </div>
        </section>
      </section>`;

    document.body.appendChild(backdrop);
    const dialog = backdrop.querySelector('.sp-import-dialog');
    const startPanel = backdrop.querySelector('[data-role="start"]');
    const previewPanel = backdrop.querySelector('[data-role="preview"]');
    const completePanel = backdrop.querySelector('[data-role="complete"]');
    const errorBox = backdrop.querySelector('[data-role="error"]');
    const fileInput = backdrop.querySelector('#spImportCsvFile');
    const nameInput = backdrop.querySelector('#spImportPlaylistName');
    const summary = backdrop.querySelector('[data-role="summary"]');
    const listCount = backdrop.querySelector('[data-role="list-count"]');
    const trackList = backdrop.querySelector('[data-role="track-list"]');
    const saveButton = backdrop.querySelector('[data-action="save"]');
    let libraryTracks = [];
    let rows = [];
    let loadedFileName = '';
    let isSaving = false;

    function showError(message) {
      errorBox.hidden = !message;
      errorBox.textContent = message || '';
    }

    function close() {
      root.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }

    function switchPanel(panel) {
      startPanel.hidden = panel !== 'start';
      previewPanel.hidden = panel !== 'preview';
      completePanel.hidden = panel !== 'complete';
      showError('');
    }

    function matchedTrackForId(id) {
      return libraryTracks.find((track) => String(track.id) === String(id)) || null;
    }

    function updateCounts() {
      const assigned = rows.filter((item) => item.selectedTrack).length;
      const automatic = rows.filter((item) => item.autoMatched && item.selectedTrack).length;
      const unresolved = rows.length - assigned;
      summary.textContent = `${automatic} matched automatically · ${assigned - automatic} selected manually · ${unresolved} to skip`;
      listCount.textContent = `${rows.length} tracks`;
      saveButton.disabled = isSaving || assigned === 0 || !nameInput.value.trim();
      saveButton.textContent = isSaving ? 'Saving…' : `Create playlist (${assigned})`;
    }

    function renderRows() {
      trackList.replaceChildren();
      rows.forEach((item, index) => {
        const row = makeElement(document, 'article', 'sp-import-track');
        const top = makeElement(document, 'div', 'sp-import-track-top');
        const details = makeElement(document, 'div', 'sp-import-track-details');
        details.appendChild(makeElement(document, 'div', 'sp-import-track-title', `${index + 1}. ${item.row.title}`));
        details.appendChild(makeElement(document, 'div', 'sp-import-track-artist', item.row.artist || 'Artist not listed in CSV'));
        top.appendChild(details);

        const status = makeElement(document, 'span', 'sp-import-status');
        const label = item.selectedTrack
          ? (item.autoMatched ? 'Matched' : 'Selected')
          : (item.status === 'missing' ? 'Not found' : 'Needs review');
        status.textContent = label;
        status.classList.add(item.selectedTrack ? 'is-matched' : item.status === 'missing' ? 'is-missing' : 'is-review');
        top.appendChild(status);
        row.appendChild(top);

        if (item.selectedTrack) {
          row.appendChild(makeElement(document, 'div', 'sp-import-match-name', `Sleeve song: ${getTrackLabel(item.selectedTrack)}`));
          const change = makeElement(document, 'button', 'sp-import-change', 'Change match');
          change.type = 'button';
          change.addEventListener('click', () => {
            item.showPicker = !item.showPicker;
            renderRows();
          });
          row.appendChild(change);
        }

        if (!item.selectedTrack || item.showPicker) {
          const picker = makeElement(document, 'div', 'sp-import-picker');
          const searchLabel = makeElement(document, 'label', 'sp-import-search-label', 'Find a song in your library');
          const search = makeElement(document, 'input', 'sp-import-track-search');
          search.type = 'search';
          search.placeholder = 'Search title, artist, album, or filename…';
          search.autocomplete = 'off';
          search.spellcheck = false;
          search.value = item.searchQuery || '';
          search.setAttribute('aria-label', `Search local songs for ${item.row.title}`);
          searchLabel.appendChild(search);
          picker.appendChild(searchLabel);

          const resultHint = makeElement(document, 'div', 'sp-import-search-hint');
          const select = makeElement(document, 'select', 'sp-import-track-select');
          select.setAttribute('aria-label', `Choose a local song for ${item.row.title}`);

          function renderPickerOptions() {
            const filteredTracks = filterLibraryTracks(item.searchQuery || '', libraryTracks);
            select.replaceChildren();

            const skip = makeElement(document, 'option', '', 'Skip this track');
            skip.value = '';
            select.appendChild(skip);

            // Keep the current match visible while searching, even if the search
            // text no longer matches it. Typing does not silently change a choice.
            const selectedId = item.selectedTrack ? String(item.selectedTrack.id) : '';
            const selectedIsInResults = filteredTracks.some((track) => String(track.id) === selectedId);
            if (item.selectedTrack && selectedId && !selectedIsInResults) {
              const currentOption = makeElement(document, 'option', '', `Current selection — ${getTrackLabel(item.selectedTrack)}`);
              currentOption.value = selectedId;
              select.appendChild(currentOption);
            }

            filteredTracks.forEach((track) => {
              const option = makeElement(document, 'option', '', getTrackLabel(track));
              option.value = String(track.id);
              select.appendChild(option);
            });

            select.value = selectedId && (selectedIsInResults || item.selectedTrack) ? selectedId : '';
            resultHint.textContent = item.searchQuery
              ? (filteredTracks.length ? `${filteredTracks.length} matching song${filteredTracks.length === 1 ? '' : 's'}` : 'No songs match that search. Try a title, artist, or filename.')
              : `${filteredTracks.length} local songs available · Type to search`;
          }

          search.addEventListener('input', () => {
            item.searchQuery = search.value;
            renderPickerOptions();
          });
          select.addEventListener('change', () => {
            if (select.value === '__sp_no_search_results__') return;
            item.selectedTrack = select.value ? matchedTrackForId(select.value) : null;
            item.autoMatched = false;
            item.showPicker = false;
            updateCounts();
            renderRows();
          });

          picker.appendChild(resultHint);
          picker.appendChild(select);
          row.appendChild(picker);
          renderPickerOptions();
        }
        trackList.appendChild(row);
      });
      updateCounts();
    }

    async function processSelectedFile(file) {
      if (!file) return;
      showError('');
      fileInput.disabled = true;
      try {
        if (!/\.csv$/i.test(file.name)) throw new Error('Choose a .csv file exported from Exportify.');
        const csvRows = parseCsv(await file.text());
        const library = await readLibrary(root);
        libraryTracks = library.tracks.filter((track) => track && track.kind !== 'video' && track.id != null);
        if (!libraryTracks.length) {
          throw new Error('Sleeve has no saved local audio tracks yet. Add your downloaded audio files to Sleeve, then import this CSV again.');
        }
        const matches = matchPlaylistRows(csvRows, libraryTracks);
        rows = matches.map((match) => ({
          row: match.row,
          status: match.status,
          candidates: match.candidates,
          selectedTrack: match.match,
          autoMatched: Boolean(match.match),
          showPicker: false
        }));
        loadedFileName = file.name.replace(/\.csv$/i, '').trim() || 'Imported Playlist';
        nameInput.value = loadedFileName;
        switchPanel('preview');
        renderRows();
        nameInput.focus();
        nameInput.select();
      } catch (error) {
        switchPanel('start');
        showError(error && error.message ? error.message : 'The CSV could not be imported.');
      } finally {
        fileInput.disabled = false;
        fileInput.value = '';
      }
    }

    async function savePlaylist() {
      if (isSaving) return;
      const trackIds = rows.filter((item) => item.selectedTrack).map((item) => item.selectedTrack.id);
      if (!trackIds.length) {
        showError('Choose at least one local song before creating the playlist.');
        return;
      }
      isSaving = true;
      updateCounts();
      try {
        const saved = await saveImportedPlaylist(root, nameInput.value, trackIds);
        const skipped = rows.length - trackIds.length;
        backdrop.querySelector('[data-role="complete-message"]').textContent = `“${saved.name}” was saved with ${trackIds.length} tracks in CSV order${skipped ? `; ${skipped} unmatched or skipped ${skipped === 1 ? 'track was' : 'tracks were'} left out` : ''}. Reload Sleeve to show it in your playlist list.`;
        switchPanel('complete');
      } catch (error) {
        showError(error && error.message ? error.message : 'Sleeve could not save this playlist.');
        isSaving = false;
        updateCounts();
      }
    }

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    backdrop.querySelectorAll('[data-action="close"]').forEach((button) => button.addEventListener('click', close));
    backdrop.querySelector('[data-action="back"]').addEventListener('click', () => {
      switchPanel('start');
      rows = [];
      trackList.replaceChildren();
    });
    saveButton.addEventListener('click', savePlaylist);
    nameInput.addEventListener('input', updateCounts);
    fileInput.addEventListener('change', () => processSelectedFile(fileInput.files && fileInput.files[0]));
    backdrop.querySelector('[data-action="reload"]').addEventListener('click', () => root.location.reload());
    root.addEventListener('keydown', onKeyDown, true);
    fileInput.focus();
  }

  return {
    parseCsv,
    basename,
    normalizeMusicKey,
    normalizeTrackTitle,
    normalizeTitleText,
    scoreTrackMatch,
    matchPlaylistRows,
    getTrackLabel,
    filterLibraryTracks,
    saveImportedPlaylist,
    install
  };
});
