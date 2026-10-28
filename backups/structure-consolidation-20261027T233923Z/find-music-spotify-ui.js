/* Spotify catalog integration plus direct, permitted open-license downloads.
 * Spotify audio itself is never downloaded; replacements are only accepted when
 * a strongly matching explicitly open-licensed audio file can be verified.
 */
(() => {
  'use strict';
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('fmSpotifySection')) return;

  const api = window.electronAPI;
  const overlay = document.getElementById('sleeveFindMusicOverlay');
  const content = overlay && overlay.querySelector('.find-music-content');
  const needed = [
    'findMusicSpotifyExchangeCode', 'findMusicSpotifyGetPlaylist',
    'findMusicSpotifyGetAlbum', 'findMusicSpotifyGetTrack', 'findMusicSpotifyCancel', 'spotifyLogin',
    'findMusicParseLink', 'findMusicResolveDownloadOpenAudio',
    'findMusicDownloadOpenAudioCollection', 'findMusicCancelOpenAudioCollection',
    'findMusicReadDownloadedFile'
  ];
  if (!api || !content || needed.some((name) => typeof api[name] !== 'function')) {
    console.warn('[Sleeve Find Music] Spotify playlist APIs are missing. Run the updated installer.');
    return;
  }

  const section = document.createElement('section');
  section.id = 'fmSpotifySection';
  section.className = 'find-music-card fm-spotify-card';
  section.innerHTML = `
    <div class="find-music-section-heading">
      <div>
        <h3>Spotify playlist & album</h3>
        <p>Paste a link to load its track list. Sleeve searches supported direct-download sources and only downloads high-confidence matches with explicit open-license metadata.</p>
      </div>
      <span class="fm-spotify-pill">In-app downloads</span>
    </div>
    <div class="fm-spotify-connect-row">
      <div class="fm-spotify-client-wrap">
        <label for="fmSpotifyClientId">Spotify Client ID</label>
        <input id="fmSpotifyClientId" type="text" maxlength="160" autocomplete="off" spellcheck="false" placeholder="Paste your Spotify app Client ID">
      </div>
      <button id="fmSpotifyConnect" class="find-music-secondary" type="button">Connect Spotify</button>
    </div>
    <div id="fmSpotifyAuthStatus" class="find-music-status" role="status" aria-live="polite">Not connected. Your Client ID is saved on this device; access tokens are kept in memory only.</div>
    <div class="fm-spotify-link-row">
      <div class="fm-spotify-url-wrap">
        <label for="fmSpotifyUrl">Spotify track, album, or playlist link</label>
        <input id="fmSpotifyUrl" type="url" maxlength="1000" autocomplete="off" spellcheck="false" placeholder="Paste a Spotify track, album, or playlist link">
      </div>
      <button id="fmSpotifyLoad" class="find-music-primary" type="button">Resolve link</button>
    </div>
    <div id="fmSpotifyStatus" class="find-music-status" role="status" aria-live="polite">Paste a Spotify playlist or album link. Sleeve will show one entry per track.</div>
    <div id="fmSpotifyProgressWrap" class="fm-spotify-progress-wrap" hidden>
      <div class="fm-spotify-progress-line"><span id="fmSpotifyProgressLabel">Loading…</span><span id="fmSpotifyProgressValue"></span></div>
      <progress id="fmSpotifyProgress" max="100" value="0"></progress>
      <button id="fmSpotifyCancel" class="find-music-text-button" type="button">Cancel</button>
    </div>
    <div id="fmSpotifyCollectionHeader" class="fm-spotify-collection-header" hidden></div>
    <div id="fmSpotifyTracks" class="fm-spotify-tracks" hidden></div>
    <p class="find-music-watch-note">The link identifies the requested recording or collection; it does not provide the downloaded audio. Sleeve never downloads Spotify streams. A track may be marked not found when no sufficiently confident, explicitly licensed direct-download source is available.</p>
  `;
  const firstCard = content.firstElementChild;
  if (firstCard) content.insertBefore(section, firstCard);
  else content.appendChild(section);

  const $ = (id) => document.getElementById(id);
  const clientIdInput = $('fmSpotifyClientId');
  const urlInput = $('fmSpotifyUrl');
  const connectButton = $('fmSpotifyConnect');
  const loadButton = $('fmSpotifyLoad');
  const authStatus = $('fmSpotifyAuthStatus');
  const status = $('fmSpotifyStatus');
  const progressWrap = $('fmSpotifyProgressWrap');
  const progress = $('fmSpotifyProgress');
  const progressLabel = $('fmSpotifyProgressLabel');
  const progressValue = $('fmSpotifyProgressValue');
  const cancelButton = $('fmSpotifyCancel');
  const collectionHeader = $('fmSpotifyCollectionHeader');
  const trackList = $('fmSpotifyTracks');

  const REDIRECT_URI = 'http://127.0.0.1:43897/callback';
  const CLIENT_ID_KEY = 'sleeve.findMusic.spotifyClientId';
  const SCOPES = 'playlist-read-private playlist-read-collaborative';
  let accessToken = null;
  let tokenExpiresAt = 0;
  let requestId = null;
  let generation = 0;
  let currentCollection = null;
  let parentCollection = null;
  let authInProgress = false;
  let authAttemptGeneration = 0;
  let collectionDownloadId = null;
  let downloadGeneration = 0;
  let latestZipPath = '';
  const downloadStatuses = new Map();
  const activeSingleDownloads = new Set();

  try { clientIdInput.value = localStorage.getItem(CLIENT_ID_KEY) || ''; } catch (_) {}

  function setStatus(message, kind = 'info') {
    status.textContent = message || '';
    status.className = `find-music-status${kind === 'success' ? ' find-music-status-ok' : kind === 'error' ? ' find-music-status-error' : ''}`;
  }

  function setAuthStatus(message, kind = 'info') {
    authStatus.textContent = message || '';
    authStatus.className = `find-music-status${kind === 'success' ? ' find-music-status-ok' : kind === 'error' ? ' find-music-status-error' : ''}`;
  }

  function base64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomString(byteLength = 48) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function sha256Base64Url(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return base64Url(new Uint8Array(digest));
  }

  function clientId() {
    const value = clientIdInput.value.trim();
    if (!/^[A-Za-z0-9]{20,64}$/.test(value)) throw new Error('Enter a valid Spotify Client ID first.');
    try { localStorage.setItem(CLIENT_ID_KEY, value); } catch (_) {}
    return value;
  }

  function ensureToken() {
    if (!accessToken || tokenExpiresAt < Date.now() + 30000) {
      throw new Error('Connect to Spotify before loading a playlist or album.');
    }
    return accessToken;
  }

  function setProgress(processed, total, message) {
    progressWrap.hidden = false;
    const t = Number(total) || 0;
    const p = Number(processed) || 0;
    progress.value = t > 0 ? Math.min(100, Math.round(p / t * 100)) : 0;
    progressLabel.textContent = message || 'Loading Spotify metadata…';
    progressValue.textContent = t > 0 ? `${p} / ${t}` : (p ? String(p) : '');
  }

  function hideProgress() {
    progressWrap.hidden = true;
    progress.value = 0;
    progressLabel.textContent = 'Loading…';
    progressValue.textContent = '';
  }

  async function connectSpotify() {
    if (authInProgress) return;
    let id;
    try { id = clientId(); }
    catch (error) { setAuthStatus(error.message, 'error'); return; }
    const startGeneration = generation;
    authInProgress = true;
    const authAttempt = ++authAttemptGeneration;
    connectButton.disabled = true;
    connectButton.textContent = 'Connecting…';
    setAuthStatus('Opening Spotify authorization. Sign in and approve the requested playlist permissions.', 'info');
    try {
      const verifier = randomString(64);
      const state = randomString(24);
      const challenge = await sha256Base64Url(verifier);
      const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
      authorizeUrl.search = new URLSearchParams({
        response_type: 'code', client_id: id, scope: SCOPES,
        redirect_uri: REDIRECT_URI, code_challenge_method: 'S256',
        code_challenge: challenge, state
      }).toString();
      const returned = await api.spotifyLogin(authorizeUrl.href);
      if (startGeneration !== generation) return;
      if (!returned || returned.error || !returned.code) throw new Error(returned && returned.error ? `Spotify authorization failed: ${returned.error}` : 'Spotify did not return an authorization code. Try connecting again.');
      if (returned.state !== state) throw new Error('Spotify authorization state did not match. For safety, connect again.');
      const token = await api.findMusicSpotifyExchangeCode({ clientId: id, code: returned.code, codeVerifier: verifier, redirectUri: REDIRECT_URI });
      if (startGeneration !== generation) return;
      if (!token || !token.accessToken) throw new Error('Spotify did not return an access token. Check your app settings.');
      accessToken = token.accessToken;
      tokenExpiresAt = Date.now() + Math.max(60, Number(token.expiresIn) || 3600) * 1000;
      setAuthStatus('Connected to Spotify. Paste a playlist or album URL below.', 'success');
    } catch (error) {
      if (startGeneration === generation) {
        setAuthStatus(error && error.message ? error.message : 'Could not connect to Spotify. Check the Client ID and redirect URI.', 'error');
      }
    } finally {
      if (authAttempt === authAttemptGeneration) {
        authInProgress = false;
        connectButton.disabled = false;
        connectButton.textContent = 'Connect Spotify';
        if (startGeneration !== generation && !accessToken) {
          setAuthStatus('Not connected. Your Client ID is saved on this device; choose Connect Spotify to authorize again.', 'info');
        }
      }
    }
  }

  function makeText(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function durationLabel(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return 'Duration unavailable';
    const seconds = Math.round(value / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  async function openSpotifyUrl(url) {
    if (!url || !/^https:\/\/open\.spotify\.com\//i.test(url)) return;
    try {
      await api.findMusicOpenUrl(url);
    } catch (error) { setStatus(error.message || 'Could not open the Spotify link in your normal browser.', 'error'); }
  }

  function requestIdentifier() {
    return `spotify_${Date.now().toString(36)}_${randomString(12)}`;
  }

  async function loadCollection(kind, id, titleHint = '', preserveParent = false) {
    let token;
    try { token = ensureToken(); }
    catch (error) { setStatus(error.message, 'error'); return; }
    if (requestId) api.findMusicSpotifyCancel(requestId).catch(() => {});
    const localGeneration = ++generation;
    requestId = requestIdentifier();
    const localRequestId = requestId;
    const requestPayload = { id, accessToken: token, requestId: localRequestId };
    loadButton.disabled = true;
    loadButton.textContent = 'Loading…';
    collectionHeader.hidden = true;
    trackList.hidden = true;
    trackList.replaceChildren();
    hideProgress();
    setStatus(`Loading ${kind} details from Spotify…`, 'info');
    setProgress(0, 0, `Loading ${kind}…`);
    try {
      const result = kind === 'playlist'
        ? await api.findMusicSpotifyGetPlaylist(requestPayload)
        : kind === 'album'
          ? await api.findMusicSpotifyGetAlbum(requestPayload)
          : await api.findMusicSpotifyGetTrack(requestPayload);
      if (localGeneration !== generation || requestId !== localRequestId) return;
      currentCollection = result;
      renderCollection(result);
      hideProgress();
      downloadStatuses.clear();
      latestZipPath = '';
      setStatus(`${result.tracks.length} track entr${result.tracks.length === 1 ? 'y' : 'ies'} loaded. Click Download Audio to resolve and download eligible matches into Sleeve.`, 'success');
      return result;
    } catch (error) {
      if (localGeneration !== generation || requestId !== localRequestId) return;
      hideProgress();
      trackList.replaceChildren();
      trackList.hidden = false;
      trackList.appendChild(makeText('div', 'find-music-empty', error && error.name === 'AbortError' ? 'Loading cancelled.' : (error && error.message ? error.message : `Could not load this Spotify ${kind}.`)));
      setStatus(error && error.name === 'AbortError' ? 'Loading cancelled.' : (error && error.message ? error.message : 'Could not load the Spotify collection.'), error && error.name === 'AbortError' ? 'info' : 'error');
      return null;
    } finally {
      if (localGeneration === generation) {
        requestId = null;
        loadButton.disabled = false;
        loadButton.textContent = 'Resolve link';
      }
    }
  }

  function renderCollection(collection) {
    collectionHeader.replaceChildren();
    if (collection.coverUrl) {
      try {
        const coverUrl = new URL(collection.coverUrl);
        if (coverUrl.protocol === 'https:' && coverUrl.hostname.endsWith('.scdn.co')) {
          const cover = document.createElement('img');
          cover.className = 'fm-spotify-cover';
          cover.src = coverUrl.href;
          cover.alt = '';
          cover.loading = 'lazy';
          collectionHeader.appendChild(cover);
        }
      } catch (_) {}
    }
    const headingWrap = document.createElement('div');
    headingWrap.className = 'fm-spotify-collection-title';
    headingWrap.appendChild(makeText('h4', '', collection.name || (collection.kind === 'album' ? 'Spotify album' : 'Spotify playlist')));
    const byline = [collection.owner ? `Playlist by ${collection.owner}` : '', collection.artistText || '', `${collection.tracks.length} track entr${collection.tracks.length === 1 ? 'y' : 'ies'}`].filter(Boolean).join(' · ');
    headingWrap.appendChild(makeText('p', '', byline));
    collectionHeader.appendChild(headingWrap);
    const actionWrap = document.createElement('div');
    actionWrap.className = 'fm-spotify-collection-actions';
    if (parentCollection && collection.kind === 'album') {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'find-music-secondary';
      back.textContent = 'Back to playlist';
      back.addEventListener('click', () => {
        currentCollection = parentCollection;
        parentCollection = null;
        renderCollection(currentCollection);
        setStatus('Returned to the playlist track list.', 'info');
      });
      actionWrap.appendChild(back);
    }
    const batchDownload = document.createElement('button');
    batchDownload.type = 'button';
    batchDownload.className = 'find-music-primary';
    batchDownload.dataset.role = 'collection-download';
    if (collection.kind === 'track') {
      batchDownload.textContent = activeSingleDownloads.has(0) ? 'Downloading…' : 'Download Audio';
      batchDownload.disabled = activeSingleDownloads.has(0);
      batchDownload.addEventListener('click', () => downloadSingleTrack(collection.tracks[0], 0, batchDownload));
    } else {
      batchDownload.textContent = collectionDownloadId ? 'Preparing downloads…' : 'Download Audio';
      batchDownload.disabled = Boolean(collectionDownloadId);
      batchDownload.addEventListener('click', () => downloadCollectionAsZip(collection));
    }
    actionWrap.appendChild(batchDownload);
    if (latestZipPath) {
      const revealZip = document.createElement('button');
      revealZip.type = 'button';
      revealZip.className = 'find-music-secondary';
      revealZip.textContent = 'Show ZIP in folder';
      revealZip.addEventListener('click', () => {
        if (api.showItemInFolder) api.showItemInFolder(latestZipPath);
      });
      actionWrap.appendChild(revealZip);
    }
    collectionHeader.appendChild(actionWrap);
    collectionHeader.hidden = false;

    trackList.replaceChildren();
    if (!Array.isArray(collection.tracks) || !collection.tracks.length) {
      trackList.appendChild(makeText('div', 'find-music-empty', 'This Spotify collection contains no available music tracks.'));
      trackList.hidden = false;
      return;
    }
    collection.tracks.forEach((track, index) => {
      const row = document.createElement('article');
      row.className = `fm-spotify-track${track.unavailable ? ' fm-spotify-track-unavailable' : ''}`;
      const number = makeText('span', 'fm-spotify-track-number', track.trackNumber || (index + 1));
      const details = document.createElement('div');
      details.className = 'fm-spotify-track-details';
      details.appendChild(makeText('strong', 'fm-spotify-track-name', track.name || 'Unavailable track'));
      const baseSubtitle = track.unavailable
        ? 'Not found or unavailable from Spotify metadata'
        : ([track.artistText, track.albumName, durationLabel(track.durationMs)].filter(Boolean).join(' · ') || 'Track metadata unavailable');
      const downloadState = downloadStatuses.get(index);
      details.appendChild(makeText('small', 'fm-spotify-track-subtitle', downloadState ? `${baseSubtitle} · ${downloadState}` : baseSubtitle));
      const actions = document.createElement('div');
      actions.className = 'fm-spotify-track-actions';
      if (collection.kind !== 'track' && !track.unavailable && track.name && track.artistText) {
        const directDownload = document.createElement('button');
        directDownload.type = 'button';
        directDownload.className = 'find-music-secondary fm-spotify-download-button';
        directDownload.textContent = activeSingleDownloads.has(index) ? 'Downloading…' : 'Download';
        directDownload.disabled = activeSingleDownloads.has(index);
        directDownload.addEventListener('click', () => downloadSingleTrack(track, index, directDownload));
        actions.appendChild(directDownload);
      }
      if (track.albumId && !track.unavailable && !(collection.kind === 'album' && track.albumId === collection.id)) {
        const albumButton = document.createElement('button');
        albumButton.type = 'button';
        albumButton.className = 'find-music-secondary fm-spotify-album-button';
        albumButton.textContent = 'Fetch Whole Album';
        albumButton.addEventListener('click', async () => {
          if (collection.kind === 'playlist') parentCollection = collection;
          else parentCollection = null;
          const album = await loadCollection('album', track.albumId, track.albumName, true);
          if (album && generation > 0) await downloadCollectionAsZip(album);
        });
        actions.appendChild(albumButton);
      }
      row.append(number, details, actions);
      trackList.appendChild(row);
    });
    trackList.hidden = false;
  }

  function importDownloadedPath(filePath) {
    return api.findMusicReadDownloadedFile(filePath).then((record) => {
      if (!record || !record.bytes || typeof record.name !== 'string') throw new Error('Sleeve received an invalid downloaded audio file.');
      const file = new File([record.bytes], record.name, {
        type: record.type || 'application/octet-stream',
        lastModified: Number(record.lastModified) || Date.now()
      });
      Object.defineProperty(file, '__sleeveSourcePath', { value: record.path, enumerable: false });
      window.dispatchEvent(new CustomEvent('sleeve:find-music-import-files', { detail: { files: [file] } }));
    });
  }

  async function downloadSingleTrack(track, index, button) {
    if (button.disabled || activeSingleDownloads.has(index) || collectionDownloadId) return;
    activeSingleDownloads.add(index);
    const localGeneration = generation;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Finding best match…';
    downloadStatuses.set(index, 'Searching open-license sources…');
    renderCollection(currentCollection);
    setStatus(`Searching for a licensed downloadable match for “${track.name}”…`, 'info');
    try {
      const result = await api.findMusicResolveDownloadOpenAudio({
        title: track.name,
        artist: track.artistText,
        album: track.albumName || '',
        durationMs: track.durationMs || null,
        isrc: track.isrc || ''
      });
      if (localGeneration !== generation) return;
      await importDownloadedPath(result.path);
      downloadStatuses.set(index, `Downloaded & added · ${result.licenseLabel} · ${result.matchScore}% match`);
      setStatus(`Downloaded and added “${result.name}” to Sleeve. Its source declares ${result.licenseLabel}.`, 'success');
      renderCollection(currentCollection);
    } catch (error) {
      if (localGeneration !== generation) return;
      downloadStatuses.set(index, `Not found · ${error && error.message ? error.message : 'No reliable licensed match'}`);
      setStatus(error && error.message ? error.message : 'No reliable explicitly open-licensed match was found. This track was not downloaded.', 'error');
      renderCollection(currentCollection);
    } finally {
      activeSingleDownloads.delete(index);
      if (localGeneration === generation && currentCollection) renderCollection(currentCollection);
      if (localGeneration === generation && button.isConnected) {
        button.disabled = false;
        button.textContent = previous;
      }
    }
  }

  async function downloadCollectionAsZip(collection) {
    if (!collection || !Array.isArray(collection.tracks) || !collection.tracks.length) {
      setStatus('Load a playlist or album with tracks first.', 'error');
      return;
    }
    if (collectionDownloadId) {
      setStatus('A collection download is already running. Cancel it before starting another.', 'error');
      return;
    }
    if (activeSingleDownloads.size) {
      setStatus('Wait for the current track download to finish before starting a collection ZIP.', 'error');
      return;
    }
    const eligibleTracks = collection.tracks.map((track, sourceIndex) => ({ track, sourceIndex }))
      .filter(({ track }) => !track.unavailable && track.name && track.artistText)
      .map(({ track, sourceIndex }) => ({
        sourceIndex,
        title: track.name,
        artist: track.artistText,
        album: track.albumName || '',
        durationMs: track.durationMs || null,
        isrc: track.isrc || ''
      }));
    if (!eligibleTracks.length) {
      setStatus('This collection has no tracks with enough metadata to search for a reliable match.', 'error');
      return;
    }
    const localGeneration = generation;
    const requestId = requestIdentifier();
    collectionDownloadId = requestId;
    downloadGeneration += 1;
    const localDownloadGeneration = downloadGeneration;
    const batchButton = collectionHeader.querySelector('[data-role="collection-download"]');
    if (batchButton) { batchButton.disabled = true; batchButton.textContent = 'Resolving and downloading…'; }
    setProgress(0, eligibleTracks.length, `Resolving track 1 of ${eligibleTracks.length}…`);
    setStatus(`Checking ${eligibleTracks.length} tracks for strong open-license matches. Only the best match per track is considered.`, 'info');
    try {
      const result = await api.findMusicDownloadOpenAudioCollection({
        requestId,
        collectionName: collection.name || (collection.kind === 'album' ? 'Sleeve Album' : 'Sleeve Playlist'),
        tracks: eligibleTracks
      });
      if (localGeneration !== generation || localDownloadGeneration !== downloadGeneration) return;
      let importedCount = 0;
      for (const item of result.results || []) {
        // Update row status by finding the original Spotify track without duplicating entries.
        const originalIndex = Number.isInteger(item.index) ? item.index : collection.tracks.findIndex((track) =>
          track.name === item.title && track.artistText === item.artist);
        const label = item.status === 'downloaded'
          ? `Downloaded · ${item.licenseLabel || 'open license'} · ${item.matchScore || 0}% match`
          : item.status === 'downloaded-not-zipped'
            ? `Downloaded, ZIP omitted · ${item.message || ''}`
            : `${item.status === 'not-found' ? 'Not found' : item.status} · ${item.message || ''}`;
        if (originalIndex >= 0) downloadStatuses.set(originalIndex, label);
        if (item.path && ['downloaded', 'downloaded-not-zipped'].includes(item.status)) {
          try { await importDownloadedPath(item.path); importedCount += 1; }
          catch (error) { if (originalIndex >= 0) downloadStatuses.set(originalIndex, `Downloaded, import failed · ${error.message || 'unknown error'}`); }
        }
      }
      latestZipPath = result.zipPath || '';
      renderCollection(collection);
      if (latestZipPath) {
        setStatus(`${result.note} ${importedCount} individual file${importedCount === 1 ? '' : 's'} added to your library. ZIP saved as ${result.zipName}.`, 'success');
      } else {
        setStatus(result.note || 'No eligible tracks were found to download. Unmatched songs stayed untouched.', 'info');
      }
      hideProgress();
    } catch (error) {
      if (localGeneration !== generation || localDownloadGeneration !== downloadGeneration) return;
      setStatus(error && error.message ? error.message : 'The collection download failed.', 'error');
      hideProgress();
    } finally {
      if (collectionDownloadId === requestId) collectionDownloadId = null;
      if (localGeneration === generation && currentCollection) renderCollection(currentCollection);
    }
  }

  async function loadFromUrl() {
    const parseGeneration = generation;
    const raw = urlInput.value.trim();
    if (!raw) { setStatus('Paste a Spotify track, album, or playlist URL first.', 'error'); return; }
    let reference;
    try { reference = await api.findMusicParseLink(raw); }
    catch (error) { if (parseGeneration === generation) setStatus(error && error.message ? error.message : 'This is not a supported music link.', 'error'); return; }
    if (parseGeneration !== generation) return;
    if (!reference || reference.service !== 'Spotify') {
      setStatus('This version can resolve Spotify track, album, and playlist links. Other sources can be searched in Advanced tools.', 'error'); return;
    }
    if (!['track', 'album', 'playlist'].includes(reference.type)) {
      setStatus('Paste a Spotify track, album, or playlist link.', 'error'); return;
    }
    if (!reference.id || !/^[A-Za-z0-9]{10,64}$/.test(reference.id)) {
      setStatus('Could not read a valid Spotify track, album, or playlist ID from that URL.', 'error'); return;
    }
    parentCollection = null;
    await loadCollection(reference.type, reference.id, '', false);
  }

  connectButton.addEventListener('click', connectSpotify);
  loadButton.addEventListener('click', loadFromUrl);
  urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadFromUrl(); });
  urlInput.addEventListener('paste', () => {
    window.setTimeout(() => {
      if (urlInput.value.trim() && /(?:open\.spotify\.com\/(?:track|album|playlist)\/|spotify:(?:track|album|playlist):)/i.test(urlInput.value.trim())) loadButton.click();
    }, 0);
  });
  clientIdInput.addEventListener('change', () => { accessToken = null; tokenExpiresAt = 0; setAuthStatus('Client ID updated. Connect to Spotify to authorize this app.', 'info'); });
  cancelButton.addEventListener('click', () => {
    const wasLoadingSpotify = Boolean(requestId);
    if (requestId) api.findMusicSpotifyCancel(requestId).catch(() => {});
    if (collectionDownloadId) api.findMusicCancelOpenAudioCollection(collectionDownloadId).catch(() => {});
    downloadGeneration += 1;
    collectionDownloadId = null;
    if (wasLoadingSpotify) generation += 1;
    requestId = null;
    hideProgress();
    loadButton.disabled = false;
    loadButton.textContent = 'Resolve link';
    setStatus('Loading cancelled.', 'info');
  });

  if (typeof api.findMusicOnSpotifyProgress === 'function') {
    api.findMusicOnSpotifyProgress((payload) => {
      if (!payload || payload.requestId !== requestId) return;
      setProgress(payload.processed, payload.total, payload.message);
    });
  }
  if (typeof api.findMusicOnOpenAudioCollectionProgress === 'function') {
    api.findMusicOnOpenAudioCollectionProgress((payload) => {
      if (!payload || payload.requestId !== collectionDownloadId) return;
      setProgress(payload.processed, payload.total, payload.message);
    });
  }

  function resetSpotifyTab() {
    generation += 1;
    if (requestId) api.findMusicSpotifyCancel(requestId).catch(() => {});
    if (collectionDownloadId) api.findMusicCancelOpenAudioCollection(collectionDownloadId).catch(() => {});
    downloadGeneration += 1;
    collectionDownloadId = null;
    downloadStatuses.clear();
    activeSingleDownloads.clear();
    latestZipPath = '';
    requestId = null;
    if (!authInProgress) {
      connectButton.disabled = false;
      connectButton.textContent = 'Connect Spotify';
    } else {
      connectButton.disabled = true;
      connectButton.textContent = 'Finish Spotify login…';
      setAuthStatus('A Spotify login is still waiting for a response. Finish it in the browser or wait for the login request to time out.', 'info');
    }
    loadButton.disabled = false;
    parentCollection = null;
    currentCollection = null;
    urlInput.value = '';
    trackList.replaceChildren();
    trackList.hidden = true;
    collectionHeader.replaceChildren();
    collectionHeader.hidden = true;
    hideProgress();
    loadButton.disabled = false;
    loadButton.textContent = 'Resolve link';
    setStatus('Paste a Spotify track, album, or playlist link.', 'info');
    // Keep the non-secret Client ID configuration and session token; clear all collection/search state.
    if (accessToken && tokenExpiresAt > Date.now() + 30000) setAuthStatus('Connected to Spotify. Paste a playlist or album URL below.', 'success');
    else {
      accessToken = null;
      tokenExpiresAt = 0;
      setAuthStatus('Not connected. Your Client ID is saved on this device; access tokens are kept in memory only.', 'info');
    }
  }
  document.addEventListener('sleeve:find-music-reset', resetSpotifyTab);
})();
