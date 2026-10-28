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
