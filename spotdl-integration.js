/* Sleeve spotDL integration UI. Installed by install-spotdl-integration.ps1. */
(() => {
  'use strict';

  if (window.__sleeveSpotdlInstalled) return;
  window.__sleeveSpotdlInstalled = true;

  const API = window.electronAPI;
  let overlay = null;
  let stopProgressListener = null;
  let running = false;
  let lastDownloadDir = '';

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function appendLog(message) {
    if (!overlay) return;
    const log = overlay.querySelector('#sleeveSpotdlLog');
    if (!log || !message) return;
    const line = String(message).trim();
    if (!line) return;
    const row = make('div', 'sdl-log-line', line.slice(0, 280));
    log.appendChild(row);
    while (log.children.length > 7) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function setStatus(message, kind = 'normal') {
    if (!overlay) return;
    const status = overlay.querySelector('#sleeveSpotdlStatus');
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function setBusy(busy) {
    running = busy;
    if (!overlay) return;
    const start = overlay.querySelector('#sleeveSpotdlStart');
    const cancel = overlay.querySelector('#sleeveSpotdlCancel');
    const input = overlay.querySelector('#sleeveSpotdlUrl');
    if (start) start.disabled = busy;
    if (cancel) cancel.hidden = !busy;
    if (input) input.disabled = busy;
    if (start) start.textContent = busy ? 'Downloading…' : 'Download';
  }

  function closeDialog() {
    if (running) return;
    if (typeof stopProgressListener === 'function') stopProgressListener();
    stopProgressListener = null;
    if (overlay) overlay.remove();
    overlay = null;
  }

  function addUI() {
    if (document.getElementById('sleeveSpotdlButton')) return;
    const folderButton = document.getElementById('addFolderBtn');
    if (!folderButton || !folderButton.parentElement) return;

    const button = make('button', 'add-btn add-btn-secondary sdl-launch-button');
    button.id = 'sleeveSpotdlButton';
    button.type = 'button';
    button.title = 'Download music from a Spotify link using spotDL';
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5v14l11-7z"/><path d="M3 4v16"/></svg><span>Download Spotify link</span>';
    folderButton.insertAdjacentElement('afterend', button);
    button.addEventListener('click', openDialog);
  }

  function openDialog() {
    if (overlay) return;
    overlay = make('div', 'sdl-overlay');
    overlay.id = 'sleeveSpotdlOverlay';
    overlay.innerHTML = `
      <section class="sdl-dialog" role="dialog" aria-modal="true" aria-labelledby="sleeveSpotdlTitle">
        <header class="sdl-header">
          <div><div class="sdl-eyebrow">SLEEVE DOWNLOADS</div><h2 id="sleeveSpotdlTitle">Download music</h2></div>
          <button class="sdl-icon-button" id="sleeveSpotdlClose" type="button" aria-label="Close dialog">×</button>
        </header>
        <p class="sdl-description">Paste a Spotify track, album, or playlist link. spotDL matches the song to an available audio source and saves an MP3 to your local music folder.</p>
        <label class="sdl-label" for="sleeveSpotdlUrl">Spotify link</label>
        <input id="sleeveSpotdlUrl" class="sdl-url-input" type="url" inputmode="url" autocomplete="url" placeholder="https://open.spotify.com/track/…">
        <div class="sdl-helper">Only download audio you are authorized to save. Matching can occasionally select the wrong recording.</div>
        <div id="sleeveSpotdlStatus" class="sdl-status" role="status" aria-live="polite">Checking spotDL installation…</div>
        <div id="sleeveSpotdlSetup" class="sdl-setup" hidden>
          <div class="sdl-setup-title">spotDL is not detected</div>
          <p>Install Python first if it is not already installed, then run these commands in PowerShell:</p>
          <code>python -m pip install --user --upgrade spotdl<br>python -m spotdl --download-ffmpeg<br>python -m spotdl --download-deno</code>
          <p>If <code>python</code> is not recognized but <code>py</code> works, replace <code>python</code> with <code>py</code>. If neither works, install Python from the official Windows downloads page and enable “Add Python to PATH”. Close and reopen Sleeve after setup.</p>
          <a href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">Python for Windows</a>
          <a href="https://spotdl.github.io/spotify-downloader/installation/" target="_blank" rel="noreferrer">Official installation guide</a>
        </div>
        <div id="sleeveSpotdlLog" class="sdl-log" aria-label="Download output" aria-live="polite"></div>
        <div id="sleeveSpotdlComplete" class="sdl-complete" hidden>
          <div class="sdl-complete-title">Download finished</div>
          <p id="sleeveSpotdlCompleteText"></p>
          <div class="sdl-actions sdl-actions-secondary">
            <button id="sleeveSpotdlOpenFolder" class="sdl-button sdl-secondary-button" type="button">Open download folder</button>
            <button id="sleeveSpotdlImport" class="sdl-button sdl-secondary-button" type="button">Import into Sleeve</button>
          </div>
        </div>
        <footer class="sdl-actions">
          <button id="sleeveSpotdlCancel" class="sdl-button sdl-secondary-button" type="button" hidden>Cancel download</button>
          <button id="sleeveSpotdlDone" class="sdl-button sdl-secondary-button" type="button">Close</button>
          <button id="sleeveSpotdlStart" class="sdl-button sdl-primary-button" type="button">Download</button>
        </footer>
      </section>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#sleeveSpotdlClose').addEventListener('click', closeDialog);
    overlay.querySelector('#sleeveSpotdlDone').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeDialog(); });
    overlay.querySelector('#sleeveSpotdlStart').addEventListener('click', startDownload);
    overlay.querySelector('#sleeveSpotdlUrl').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !running) startDownload();
      if (event.key === 'Escape' && !running) closeDialog();
    });
    overlay.querySelector('#sleeveSpotdlCancel').addEventListener('click', cancelDownload);
    overlay.querySelector('#sleeveSpotdlOpenFolder').addEventListener('click', openDownloadFolder);
    overlay.querySelector('#sleeveSpotdlImport').addEventListener('click', () => {
      closeDialog();
      const picker = document.getElementById('addFolderBtn');
      if (picker) picker.click();
    });

    if (API && typeof API.onSpotdlProgress === 'function') {
      stopProgressListener = API.onSpotdlProgress((payload) => {
        if (!payload) return;
        if (payload.message) appendLog(payload.message);
        if (payload.status === 'running') setStatus('Working… progress messages appear below.');
        if (payload.status === 'cancelling') setStatus('Cancellation requested…');
        if (payload.status === 'cancelled') {
          setBusy(false);
          setStatus('Download cancelled.', 'warning');
        }
        if (payload.status === 'done') {
          setBusy(false);
          lastDownloadDir = payload.downloadDir || lastDownloadDir;
          const complete = overlay && overlay.querySelector('#sleeveSpotdlComplete');
          if (complete) complete.hidden = false;
          const completeText = overlay && overlay.querySelector('#sleeveSpotdlCompleteText');
          if (completeText) completeText.textContent = `Files are saved in ${lastDownloadDir || 'your Sleeve Downloads folder'}. Choose “Import into Sleeve” to add files to your library.`;
          setStatus('Download completed.', 'success');
        }
        if (payload.status === 'error') {
          setBusy(false);
          setStatus(payload.message || 'The download failed. See the output below.', 'error');
        }
      });
    }

    overlay.querySelector('#sleeveSpotdlUrl').focus();
    checkInstallation();
  }

  async function checkInstallation() {
    if (!API || typeof API.checkSpotdl !== 'function') {
      setStatus('Sleeve’s spotDL bridge is not installed. Run the supplied installer from the Sleeve project folder.', 'error');
      return;
    }
    try {
      const result = await API.checkSpotdl();
      if (!overlay) return;
      lastDownloadDir = result.downloadDir || '';
      if (result.available) {
        setStatus(`spotDL is ready${result.version ? ` (${result.version})` : ''}. MP3 downloads will be saved to: ${lastDownloadDir}`, 'success');
      } else {
        setStatus(`spotDL was not found. Downloads are saved to: ${lastDownloadDir}`, 'warning');
        overlay.querySelector('#sleeveSpotdlSetup').hidden = false;
        overlay.querySelector('#sleeveSpotdlStart').disabled = true;
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Could not check the spotDL installation.', 'error');
    }
  }

  function isAllowedSpotifyLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.toLowerCase();
      if (!['open.spotify.com', 'spotify.com', 'www.spotify.com', 'spotify.link'].includes(host)) return false;
      return url.pathname.length > 1;
    } catch (_) {
      return false;
    }
  }

  async function startDownload() {
    if (running || !overlay) return;
    const input = overlay.querySelector('#sleeveSpotdlUrl');
    const url = input.value.trim();
    if (!isAllowedSpotifyLink(url)) {
      setStatus('Paste a valid HTTPS Spotify track, album, playlist, or artist link.', 'error');
      input.focus();
      return;
    }
    if (!API || typeof API.startSpotdlDownload !== 'function') {
      setStatus('The spotDL bridge is missing. Run install-spotdl-integration.ps1 from your Sleeve project folder.', 'error');
      return;
    }
    overlay.querySelector('#sleeveSpotdlSetup').hidden = true;
    overlay.querySelector('#sleeveSpotdlComplete').hidden = true;
    overlay.querySelector('#sleeveSpotdlLog').replaceChildren();
    setBusy(true);
    setStatus('Starting spotDL…');
    try {
      const result = await API.startSpotdlDownload(url);
      if (!overlay) return;
      if (!result || !result.ok) {
        setBusy(false);
        if (result && result.cancelled) setStatus('Download cancelled.', 'warning');
        else setStatus((result && result.error) || 'Could not start the download.', 'error');
      }
    } catch (error) {
      setBusy(false);
      setStatus(error && error.message ? error.message : 'The download failed to start.', 'error');
    }
  }

  async function cancelDownload() {
    if (!running || !API || typeof API.cancelSpotdlDownload !== 'function') return;
    try {
      const result = await API.cancelSpotdlDownload();
      setStatus(result && result.ok ? 'Cancellation requested…' : ((result && result.error) || 'No active download.'), 'warning');
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Could not cancel the download.', 'error');
    }
  }

  async function openDownloadFolder() {
    if (!API || typeof API.openSpotdlFolder !== 'function') return;
    try {
      const result = await API.openSpotdlFolder();
      if (!result || !result.ok) setStatus((result && result.error) || 'Could not open the download folder.', 'error');
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Could not open the download folder.', 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addUI, { once: true });
  else addUI();
})();
