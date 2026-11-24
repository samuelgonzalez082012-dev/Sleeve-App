/* Sleeve spotDL UI.
 * CSS is bundled into this file so the feature no longer needs a separate stylesheet.
 * The privileged downloader remains in main.js and is exposed through preload.js.
 */
(() => {
  'use strict';

  if (window.__sleeveSpotdlInstalled) return;
  window.__sleeveSpotdlInstalled = true;

  const API = window.electronAPI;
  let overlay = null;
  let stopProgressListener = null;
  let running = false;
  let enhancing = false;
  let lastDownloadDir = '';
  let spotdlAvailable = false;
  let rightsConfirmed = false;

  const FORMAT_LABELS = {
    m4a: 'M4A — best available, avoid extra bitrate conversion',
    opus: 'Opus — efficient, avoid extra bitrate conversion',
    mp3: 'MP3 — broad compatibility'
  };

  function installStyles() {
    if (document.getElementById('sleeveSpotdlStyles')) return;
    const style = document.createElement('style');
    style.id = 'sleeveSpotdlStyles';
    style.textContent = String.raw`
      .sdl-launch-button{display:flex;align-items:center;justify-content:flex-start;gap:10px}
      .sdl-launch-button svg{width:18px;height:18px;flex:0 0 18px}
      .sdl-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;background:rgba(5,8,15,.72);backdrop-filter:blur(8px)}
      .sdl-dialog{width:min(640px,100%);max-height:min(88vh,900px);overflow-y:auto;padding:24px;border:1px solid rgba(150,165,190,.24);border-radius:18px;color:var(--text-primary,#f4f6fb);background:var(--panel-bg,#141923);box-shadow:0 24px 80px rgba(0,0,0,.45)}
      .sdl-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}
      .sdl-header h2{margin:4px 0 0;font-size:24px;line-height:1.2}
      .sdl-eyebrow{color:var(--accent,#8ba8ff);font-size:11px;font-weight:750;letter-spacing:.14em}
      .sdl-icon-button{flex:0 0 auto;width:34px;height:34px;border:1px solid rgba(150,165,190,.22);border-radius:9px;color:inherit;background:transparent;font-size:24px;cursor:pointer}
      .sdl-description{color:var(--text-secondary,#b2bac9);font-size:13px;line-height:1.55;margin:0 0 18px}
      .sdl-label{display:block;margin:13px 0 7px;font-size:12px;font-weight:700}
      .sdl-url-input,.sdl-format-select{display:block;width:100%;box-sizing:border-box;min-height:43px;border:1px solid rgba(150,165,190,.32);border-radius:10px;padding:11px 12px;color:inherit;background:var(--panel-bg,#141923);outline:none}
      .sdl-url-input:focus,.sdl-format-select:focus{border-color:var(--accent,#8ba8ff);box-shadow:0 0 0 3px rgba(139,168,255,.14)}
      .sdl-helper{margin-top:8px;color:var(--text-secondary,#aab2c1);font-size:11px;line-height:1.5}
      .sdl-quality-note{margin-top:12px;padding:11px 12px;border:1px solid rgba(150,165,190,.18);border-radius:10px;background:rgba(150,165,190,.055);font-size:11px;line-height:1.55;color:var(--text-secondary,#b2bac9)}
      .sdl-artist-context{margin:12px 0;padding:12px;border:1px solid rgba(30,215,96,.25);border-radius:10px;background:rgba(30,215,96,.055);font-size:12px;line-height:1.5}
      .sdl-artist-context p{margin:6px 0 10px;color:var(--text-secondary,#b2bac9)}
      .sdl-artist-context[hidden]{display:none!important}
      .sdl-rights-confirm{display:flex;align-items:flex-start;gap:9px;margin-top:14px;padding:12px;border:1px solid rgba(232,177,67,.28);border-radius:10px;background:rgba(232,177,67,.055);font-size:11px;line-height:1.5}
      .sdl-rights-confirm input{flex:0 0 auto;margin:2px 0 0;accent-color:var(--accent,#8ba8ff)}
      .sdl-find-music-card{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .sdl-find-music-card h3{margin:0 0 5px}
      .sdl-find-music-card p{margin:0;color:var(--text-secondary,#aab2c1);font-size:12px;line-height:1.5}
      .sdl-enhance-offer{display:flex;flex-direction:column;gap:9px;margin-top:12px;padding:12px;border:1px solid rgba(150,165,190,.22);border-radius:10px;background:rgba(150,165,190,.055)}
      .sdl-enhance-offer p{margin:0;font-size:11px;line-height:1.5;color:var(--text-secondary,#aab2c1)}
      .sdl-find-music-card .sdl-launch-button{flex:0 0 auto}
      @media(max-width:560px){.sdl-find-music-card .sdl-launch-button{width:100%;justify-content:center}}
      .sdl-status{margin-top:15px;padding:11px 12px;border:1px solid rgba(150,165,190,.2);border-radius:10px;background:rgba(150,165,190,.07);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
      .sdl-status[data-kind="success"]{border-color:rgba(77,190,132,.32)}
      .sdl-status[data-kind="warning"]{border-color:rgba(232,177,67,.35)}
      .sdl-status[data-kind="error"]{border-color:rgba(230,97,97,.4)}
      .sdl-setup{margin-top:12px;padding:14px;border:1px solid rgba(232,177,67,.25);border-radius:10px;background:rgba(232,177,67,.06);font-size:12px;line-height:1.5}
      .sdl-setup-title,.sdl-complete-title{font-weight:750;margin-bottom:6px}
      .sdl-setup p,.sdl-complete p{margin:6px 0 10px;color:var(--text-secondary,#bac2d0)}
      .sdl-setup code{display:block;padding:10px;border-radius:8px;overflow-wrap:anywhere;background:rgba(0,0,0,.2);font-size:11px;line-height:1.8}
      .sdl-setup a{display:inline-block;margin:5px 12px 0 0;color:var(--accent,#9bb5ff)}
      .sdl-log{max-height:155px;overflow:auto;margin-top:12px;padding:9px 11px;border-radius:9px;background:rgba(0,0,0,.22);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;line-height:1.55;color:#c8d0df;overflow-wrap:anywhere}
      .sdl-log:empty{display:none}.sdl-log-line+.sdl-log-line{margin-top:3px}
      .sdl-complete{margin-top:12px;padding:13px;border:1px solid rgba(77,190,132,.28);border-radius:10px;background:rgba(77,190,132,.06);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
      .sdl-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:20px}
      .sdl-actions-secondary{justify-content:flex-start;margin-top:12px}
      .sdl-button{min-height:37px;padding:8px 13px;border:1px solid transparent;border-radius:9px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
      .sdl-button:disabled{opacity:.5;cursor:not-allowed}.sdl-primary-button{color:#fff;background:var(--accent,#4569c9)}
      .sdl-secondary-button{color:inherit;background:rgba(150,165,190,.09);border-color:rgba(150,165,190,.22)}
      .sdl-button[hidden],.sdl-setup[hidden],.sdl-complete[hidden]{display:none!important}
      @media(max-width:560px){.sdl-overlay{padding:10px}.sdl-dialog{padding:17px;border-radius:14px}.sdl-header h2{font-size:21px}.sdl-actions{justify-content:stretch}.sdl-actions .sdl-button{flex:1 1 125px}}
    `;
    document.head.appendChild(style);
  }

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
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function setBusy(busy) {
    running = busy;
    if (!overlay) return;
    const start = overlay.querySelector('#sleeveSpotdlStart');
    const cancel = overlay.querySelector('#sleeveSpotdlCancel');
    const input = overlay.querySelector('#sleeveSpotdlUrl');
    const format = overlay.querySelector('#sleeveSpotdlFormat');
    const rights = overlay.querySelector('#sleeveSpotdlRights');
    if (start) start.disabled = busy || !spotdlAvailable || !rightsConfirmed;
    if (cancel) cancel.hidden = !busy;
    if (input) input.disabled = busy;
    if (format) format.disabled = busy;
    if (rights) rights.disabled = busy;
    if (start) start.textContent = busy ? 'Downloading…' : 'Download';
  }

  function closeDialog() {
    if (running || enhancing) return;
    if (typeof stopProgressListener === 'function') stopProgressListener();
    stopProgressListener = null;
    if (overlay) overlay.remove();
    overlay = null;
  }

  let addUiAttempts = 0;
  function addUI() {
    if (document.getElementById('sleeveSpotdlButton')) return;
    const content = document.querySelector('#sleeveFindMusicOverlay .find-music-content');
    if (!content) {
      if (addUiAttempts++ < 30) setTimeout(addUI, 100);
      else console.warn('[Sleeve spotDL] Find Music content was not available; downloader UI was not attached.');
      return;
    }

    const section = make('section', 'find-music-card sdl-find-music-card');
    section.innerHTML = `
      <div class="sdl-find-music-copy">
        <h3>Spotify link downloader</h3>
        <p>Download a track, album, or playlist into Sleeve Downloads. Choose a format and optionally create normalized copies after download.</p>
      </div>
      <button id="sleeveSpotdlButton" class="find-music-primary sdl-launch-button" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5v14l11-7z"/><path d="M3 4v16"/></svg>
        <span>Download from Spotify link</span>
      </button>`;
    content.appendChild(section);
    section.querySelector('#sleeveSpotdlButton').addEventListener('click', openDialog);
  }

  function openDialog(options = {}) {
    if (overlay) return;
    rightsConfirmed = false;
    spotdlAvailable = false;
    installStyles();
    overlay = make('div', 'sdl-overlay');
    overlay.id = 'sleeveSpotdlOverlay';
    overlay.innerHTML = `
      <section class="sdl-dialog" role="dialog" aria-modal="true" aria-labelledby="sleeveSpotdlTitle">
        <header class="sdl-header">
          <div><div class="sdl-eyebrow">SLEEVE DOWNLOADS</div><h2 id="sleeveSpotdlTitle">Download music</h2></div>
          <button class="sdl-icon-button" id="sleeveSpotdlClose" type="button" aria-label="Close dialog">×</button>
        </header>
        <p class="sdl-description">Paste a Spotify track, album, or playlist link. spotDL looks for a matching audio source and saves the result to your local music folder.</p>
        <label class="sdl-label" for="sleeveSpotdlUrl">Spotify link</label>
        <input id="sleeveSpotdlUrl" class="sdl-url-input" type="url" inputmode="url" autocomplete="url" placeholder="https://open.spotify.com/track/…">
        <label class="sdl-label" for="sleeveSpotdlFormat">Output format</label>
        <select id="sleeveSpotdlFormat" class="sdl-format-select">
          <option value="m4a" selected>M4A — recommended, skip unnecessary conversion</option>
          <option value="opus">Opus — efficient, skip unnecessary conversion</option>
          <option value="mp3">MP3 — broad compatibility</option>
        </select>
        <div class="sdl-helper">M4A and Opus use spotDL’s bitrate-disable option to skip an extra conversion where supported. The output format cannot restore quality missing from the source.</div>
        <div class="sdl-quality-note"><strong>Quality note:</strong> changing the output format cannot improve a low-quality source. spotDL documents a typical 128 kbps ceiling for standard sources; its documented YouTube Music Premium route can reach up to 256 kbps M4A when properly configured. The format name alone does not guarantee a particular bitrate.</div>
        <div id="sleeveSpotdlArtistContext" class="sdl-artist-context" hidden>
          <strong id="sleeveSpotdlArtistName"></strong>
          <p>Choose the correct artist or track on Spotify, then copy its actual Spotify page URL into the field above. Search-result URLs are not download links.</p>
          <button id="sleeveSpotdlOpenArtistSearch" class="sdl-button sdl-secondary-button" type="button">Open Spotify artist search</button>
        </div>
        <label class="sdl-rights-confirm"><input id="sleeveSpotdlRights" type="checkbox"><span>I confirm that I own this recording or have permission to download it, and that my use complies with the source terms and applicable law.</span></label>
        <div id="sleeveSpotdlStatus" class="sdl-status" role="status" aria-live="polite">Checking spotDL installation…</div>
        <div id="sleeveSpotdlSetup" class="sdl-setup" hidden>
          <div class="sdl-setup-title">spotDL is not detected</div>
          <p>Install Python if needed, then run these commands in PowerShell:</p>
          <code>python -m pip install --user --upgrade spotdl<br>python -m spotdl --download-ffmpeg<br>python -m spotdl --download-deno</code>
          <p>If <code>python</code> is not recognized but <code>py</code> works, replace <code>python</code> with <code>py</code>. Close and reopen Sleeve after setup.</p>
          <a href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">Python for Windows</a>
          <a href="https://spotdl.github.io/spotify-downloader/installation/" target="_blank" rel="noreferrer">Official installation guide</a>
        </div>
        <div id="sleeveSpotdlLog" class="sdl-log" aria-label="Download output" aria-live="polite"></div>
        <div id="sleeveSpotdlComplete" class="sdl-complete" hidden>
          <div class="sdl-complete-title">Download finished</div>
          <p id="sleeveSpotdlCompleteText"></p>
          <div id="sleeveSpotdlEnhanceOffer" class="sdl-enhance-offer" hidden>
            <strong>Create enhanced copies?</strong>
            <p>FFmpeg can apply loudness normalization and peak limiting. This creates separate files in the Enhanced folder; your original downloads stay untouched.</p>
            <button id="sleeveSpotdlEnhanceButton" class="sdl-button sdl-primary-button" type="button">Create enhanced copies</button>
          </div>
          <div class="sdl-actions sdl-actions-secondary">
            <button id="sleeveSpotdlOpenFolder" class="sdl-button sdl-secondary-button" type="button">Open download folder</button>
            <button id="sleeveSpotdlImport" class="sdl-button sdl-secondary-button" type="button">Import into Sleeve</button>
          </div>
        </div>
        <footer class="sdl-actions">
          <button id="sleeveSpotdlCancel" class="sdl-button sdl-secondary-button" type="button" hidden>Cancel download</button>
          <button id="sleeveSpotdlDone" class="sdl-button sdl-secondary-button" type="button">Close</button>
          <button id="sleeveSpotdlStart" class="sdl-button sdl-primary-button" type="button" disabled>Download</button>
        </footer>
      </section>`;
    document.body.appendChild(overlay);

    const rightsCheckbox = overlay.querySelector('#sleeveSpotdlRights');
    const startButton = overlay.querySelector('#sleeveSpotdlStart');
    rightsCheckbox.addEventListener('change', () => {
      rightsConfirmed = rightsCheckbox.checked === true;
      if (startButton) startButton.disabled = running || !spotdlAvailable || !rightsConfirmed;
    });

    const artistContext = overlay.querySelector('#sleeveSpotdlArtistContext');
    const artistName = String(options && options.artistName || '').trim().slice(0, 200);
    const artistSearchUrl = String(options && options.artistSearchUrl || '').trim();
    if (artistName && window.SleeveSpotifyLinks && window.SleeveSpotifyLinks.isSpotifySearchUrl(artistSearchUrl)) {
      artistContext.hidden = false;
      overlay.querySelector('#sleeveSpotdlArtistName').textContent = `Discovered artist: ${artistName}`;
      overlay.querySelector('#sleeveSpotdlOpenArtistSearch').addEventListener('click', async () => {
        try {
          if (!API || typeof API.findMusicOpenUrl !== 'function') throw new Error('Spotify link opening is unavailable.');
          await API.findMusicOpenUrl(artistSearchUrl);
        } catch (error) {
          setStatus(error && error.message ? error.message : 'Could not open Spotify artist search.', 'error');
        }
      });
    }

    overlay.querySelector('#sleeveSpotdlClose').addEventListener('click', closeDialog);
    overlay.querySelector('#sleeveSpotdlDone').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (event) => { if (event.target === overlay && !enhancing) closeDialog(); });
    overlay.querySelector('#sleeveSpotdlStart').addEventListener('click', startDownload);
    overlay.querySelector('#sleeveSpotdlUrl').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !running) startDownload();
      if (event.key === 'Escape' && !running) closeDialog();
    });
    overlay.querySelector('#sleeveSpotdlCancel').addEventListener('click', cancelDownload);
    overlay.querySelector('#sleeveSpotdlOpenFolder').addEventListener('click', openDownloadFolder);
    overlay.querySelector('#sleeveSpotdlEnhanceButton').addEventListener('click', enhanceDownloadedCopies);
    overlay.querySelector('#sleeveSpotdlImport').addEventListener('click', () => {
      closeDialog();
      const picker = document.getElementById('addFolderBtn');
      if (picker) picker.click();
    });

    if (API && typeof API.onSpotdlProgress === 'function') {
      stopProgressListener = API.onSpotdlProgress((payload) => {
        if (!payload) return;
        if (payload.message) appendLog(payload.message);
        if (payload.status === 'running') setStatus('Working… downloader output appears below.');
        if (payload.status === 'enhancing') setStatus(payload.message || 'Creating enhanced copies. Original downloads remain untouched.');
        if (payload.status === 'cancelling') setStatus('Cancellation requested…');
        if (payload.status === 'cancelled') {
          setBusy(false);
          setStatus('Download cancelled.', 'warning');
        }
        if (payload.status === 'done') {
          setBusy(false);
          enhancing = false;
          lastDownloadDir = payload.downloadDir || lastDownloadDir;
          const complete = overlay && overlay.querySelector('#sleeveSpotdlComplete');
          if (complete) complete.hidden = false;
          const completeText = overlay && overlay.querySelector('#sleeveSpotdlCompleteText');
          const selectedFormat = overlay && overlay.querySelector('#sleeveSpotdlFormat')?.value;
          const offer = overlay && overlay.querySelector('#sleeveSpotdlEnhanceOffer');
          const enhanceButton = overlay && overlay.querySelector('#sleeveSpotdlEnhanceButton');
          if (offer) offer.hidden = !payload.enhancementAvailable;
          if (enhanceButton) { enhanceButton.disabled = false; enhanceButton.textContent = 'Create enhanced copies'; }
          if (completeText) {
            const countText = Number(payload.newFileCount) === 1 ? '1 new audio file' : `${Number(payload.newFileCount) || 0} new audio files`;
            const offerText = payload.enhancementAvailable ? ` Found ${countText}. You can optionally create enhanced copies below.` : ' No new audio files were detected for enhancement.';
            completeText.textContent = `Files are saved in ${lastDownloadDir || 'your Sleeve Downloads folder'}. Output format selected: ${(FORMAT_LABELS[selectedFormat] || selectedFormat || 'default')}.${offerText} Use “Import into Sleeve” to select the download folder in Sleeve’s existing import flow.`;
          }
          setStatus('Download completed. You can now choose whether to create separate enhanced copies.', 'success');
        }
        if (payload.status === 'enhancing') {
          enhancing = true;
          const button = overlay && overlay.querySelector('#sleeveSpotdlEnhanceButton');
          if (button) { button.disabled = true; button.textContent = 'Enhancing…'; }
          setStatus(payload.message || 'Creating separate enhanced copies…');
        }
        if (payload.status === 'enhance-done') {
          enhancing = false;
          const offer = overlay && overlay.querySelector('#sleeveSpotdlEnhanceOffer');
          const button = overlay && overlay.querySelector('#sleeveSpotdlEnhanceButton');
          if (offer) offer.hidden = true;
          if (button) { button.disabled = false; button.textContent = 'Create enhanced copies'; }
          setStatus(`Created ${payload.enhancedCount || 0} enhanced copy/copies. Original downloads remain unchanged.`, 'success');
          const completeText = overlay && overlay.querySelector('#sleeveSpotdlCompleteText');
          if (completeText) completeText.textContent += ` Created ${payload.enhancedCount || 0} separate enhanced copy/copies in the Enhanced subfolder.`;
        }
        if (payload.status === 'enhance-error') {
          enhancing = false;
          const button = overlay && overlay.querySelector('#sleeveSpotdlEnhanceButton');
          if (button) { button.disabled = false; button.textContent = 'Try enhanced copies again'; }
          setStatus(payload.message || 'Could not create enhanced copies. Original downloads remain unchanged.', 'warning');
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
      setStatus('Sleeve’s spotDL bridge is not installed. Apply the Sleeve audio-quality update from the project folder.', 'error');
      const start = overlay && overlay.querySelector('#sleeveSpotdlStart');
      if (start) start.disabled = true;
      return;
    }
    try {
      const result = await API.checkSpotdl();
      if (!overlay) return;
      lastDownloadDir = result.downloadDir || '';
      spotdlAvailable = result.available === true;
      if (spotdlAvailable) {
        const start = overlay.querySelector('#sleeveSpotdlStart');
        if (start) start.disabled = !rightsConfirmed;
        setStatus(`spotDL is ready${result.version ? ` (${result.version})` : ''}. Downloads are saved to: ${lastDownloadDir}`, 'success');
      } else {
        spotdlAvailable = false;
        setStatus(`spotDL was not found. Downloads are saved to: ${lastDownloadDir}`, 'warning');
        overlay.querySelector('#sleeveSpotdlSetup').hidden = false;
        overlay.querySelector('#sleeveSpotdlStart').disabled = true;
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Could not check the spotDL installation.', 'error');
    }
  }

  function isAllowedSpotifyLink(value) {
    return Boolean(window.SleeveSpotifyLinks &&
      typeof window.SleeveSpotifyLinks.isSpotifyContentUrl === 'function' &&
      window.SleeveSpotifyLinks.isSpotifyContentUrl(value));
  }

  async function startDownload() {
    if (running || !overlay) return;
    if (!rightsConfirmed) {
      setStatus('Confirm that you have the rights or permission to download this recording before continuing.', 'warning');
      return;
    }
    const input = overlay.querySelector('#sleeveSpotdlUrl');
    const formatControl = overlay.querySelector('#sleeveSpotdlFormat');
    const url = input.value.trim();
    const format = formatControl ? formatControl.value : 'm4a';
    if (!isAllowedSpotifyLink(url)) {
      setStatus('Paste a valid HTTPS Spotify track, album, playlist, or artist link.', 'error');
      input.focus();
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(FORMAT_LABELS, format)) {
      setStatus('Choose a supported output format.', 'error');
      return;
    }
    if (!API || typeof API.startSpotdlDownload !== 'function') {
      setStatus('The spotDL bridge is missing. Apply the Sleeve audio-quality update from the project folder.', 'error');
      return;
    }
    overlay.querySelector('#sleeveSpotdlSetup').hidden = true;
    overlay.querySelector('#sleeveSpotdlComplete').hidden = true;
    overlay.querySelector('#sleeveSpotdlLog').replaceChildren();
    setBusy(true);
    setStatus(`Starting spotDL using ${format.toUpperCase()} output…`);
    try {
      const result = await API.startSpotdlDownload(url, { format });
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

  async function enhanceDownloadedCopies() {
    if (running || enhancing || !overlay || !API || typeof API.enhanceSpotdlDownload !== 'function') return;
    enhancing = true;
    const button = overlay.querySelector('#sleeveSpotdlEnhanceButton');
    if (button) { button.disabled = true; button.textContent = 'Enhancing…'; }
    setStatus('Starting FFmpeg enhancement. The original downloaded files will not be changed.');
    try {
      const result = await API.enhanceSpotdlDownload();
      if (!result || !result.ok) {
        enhancing = false;
        if (button) { button.disabled = false; button.textContent = 'Try enhanced copies again'; }
        setStatus((result && result.error) || 'Could not create enhanced copies. Originals are unchanged.', 'warning');
      }
    } catch (error) {
      enhancing = false;
      if (button) { button.disabled = false; button.textContent = 'Try enhanced copies again'; }
      setStatus(error && error.message ? error.message : 'Enhancement failed. Original downloads are unchanged.', 'warning');
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

  window.SleeveSpotdl = Object.freeze({ openDialog });

  installStyles();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addUI, { once: true });
  else addUI();
})();
