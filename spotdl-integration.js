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
  let lastDownloadDir = '';

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
    if (start) start.disabled = busy;
    if (cancel) cancel.hidden = !busy;
    if (input) input.disabled = busy;
    if (format) format.disabled = busy;
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
    button.title = 'Download an authorized recording matched from a Spotify link using spotDL';
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5v14l11-7z"/><path d="M3 4v16"/></svg><span>Download Spotify link</span>';
    folderButton.insertAdjacentElement('afterend', button);
    button.addEventListener('click', openDialog);
  }

  function openDialog() {
    if (overlay) return;
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
          <option value="m4a">M4A — best available, avoid extra bitrate conversion</option>
          <option value="opus">Opus — efficient, avoid extra bitrate conversion</option>
          <option value="mp3">MP3 — broad compatibility</option>
        </select>
        <div class="sdl-helper">M4A and Opus use spotDL’s documented bitrate-disable option to skip an extra bitrate conversion where supported. Choose MP3 when device compatibility matters more than avoiding that step.</div>
        <div class="sdl-quality-note"><strong>Quality note:</strong> changing the output format cannot improve a low-quality source. spotDL documents a typical 128 kbps ceiling for standard sources; its documented YouTube Music Premium route can reach up to 256 kbps M4A when properly configured. The format name alone does not guarantee a particular bitrate.</div>
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
        if (payload.status === 'running') setStatus('Working… downloader output appears below.');
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
          const selectedFormat = overlay && overlay.querySelector('#sleeveSpotdlFormat')?.value;
          if (completeText) {
            completeText.textContent = `Files are saved in ${lastDownloadDir || 'your Sleeve Downloads folder'}. Output format selected: ${(FORMAT_LABELS[selectedFormat] || selectedFormat || 'default')}. Use “Import into Sleeve” to select the download folder in Sleeve’s existing import flow.`;
          }
          setStatus('Download completed. The output format does not guarantee a specific source bitrate.', 'success');
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
      if (result.available) {
        setStatus(`spotDL is ready${result.version ? ` (${result.version})` : ''}. Downloads are saved to: ${lastDownloadDir}`, 'success');
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

  installStyles();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addUI, { once: true });
  else addUI();
})();
