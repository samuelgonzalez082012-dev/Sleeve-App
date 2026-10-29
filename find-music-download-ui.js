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
