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
