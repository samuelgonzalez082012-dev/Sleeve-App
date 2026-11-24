/* Sleeve MiniPlayer v3
 * Floating-card UI, built-in EQ and lyrics views, and live mirroring of
 * Sleeve's saved appearance settings. Playback remains owned by renderer.js.
 */
(() => {
  'use strict';

  if (new URLSearchParams(window.location.search).get('mini') !== '1') return;
  if (window.__sleeveMiniPlayerV3Installed) return;
  window.__sleeveMiniPlayerV3Installed = true;

  const STATE_KEY = 'sleeveMiniPlayerState';
  const PREFS_KEY = 'sleeveMiniPlayerUiPrefs';
  const EQ_STATE_KEY = 'sleeveEq';
  const SETTINGS_KEY = 'sleeveSettings';
  const DB_NAME = 'sleeveDB';
  const STORE_NAME = 'tracks';

  const byId = (id) => document.getElementById(id);
  const shell = byId('miniShell');
  const panel = byId('miniPanel');
  const card = document.querySelector('.mini-card');
  const artWrap = document.querySelector('.mini-art-wrap');
  const art = document.querySelector('.mini-art');
  const overlay = document.querySelector('.mini-overlay');
  const title = document.querySelector('.mini-title');
  const subtitle = document.querySelector('.mini-sub');
  const meta = byId('miniMeta');
  const controls = document.querySelector('.mini-controls');
  const leftControls = document.querySelector('.mini-left');
  const rightControls = document.querySelector('.mini-right');
  const progress = document.querySelector('.mini-progress');
  const progressFill = document.querySelector('.mini-progress-fill');
  const volume = byId('miniVolume');
  const panelToggle = byId('miniPanelToggle');
  const miniList = byId('miniPlaylistList');
  const miniBreadcrumb = byId('miniBreadcrumb');
  const legacyPlaylistTab = byId('miniTabPlaylists');
  const legacyArtistsTab = byId('miniTabArtists');

  if (!shell || !panel || !card || !artWrap || !title || !subtitle || !controls ||
      !leftControls || !rightControls || !progress || !progressFill || !volume ||
      !miniList || !legacyPlaylistTab || !legacyArtistsTab) {
    console.warn('[Sleeve MiniPlayer] Existing popup structure was incomplete; keeping the original view.');
    return;
  }

  const safeJson = (value, fallback) => {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && parsed !== null ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const readState = () => safeJson(localStorage.getItem(STATE_KEY), {});
  const readPrefs = () => safeJson(localStorage.getItem(PREFS_KEY), {});
  const readSettings = () => safeJson(localStorage.getItem(SETTINGS_KEY), {});
  const formatTime = (seconds) => {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  };
  const writePrefs = () => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ frameExpanded, lyricsVisible })); } catch (_) {}
  };
  const safeText = (node, value) => {
    if (node) node.textContent = String(value == null ? '' : value);
  };
  const postAction = (action, value) => {
    try {
      const opener = window.opener;
      if (opener && !opener.closed) {
        opener.postMessage({ source: 'sleeve-mini-player', action, value }, window.location.origin);
      }
    } catch (_) {}
  };
  const mainDocument = () => {
    try {
      return window.opener && !window.opener.closed ? window.opener.document : null;
    } catch (_) {
      return null;
    }
  };
  const clickMainControl = (id) => {
    const doc = mainDocument();
    const button = doc && doc.getElementById(id);
    if (!button || button.disabled) return false;
    try { button.click(); return true; } catch (_) { return false; }
  };

  const style = document.createElement('style');
  style.id = 'sleeveMiniPlayerV3Styles';
  style.textContent = `
    :root{color-scheme:dark;--mp-bg:var(--bg,#0a1526);--mp-panel:var(--bg-elevated,#16233a);--mp-card:var(--bg-card,#121e33);--mp-text:var(--text,#eef1f6);--mp-muted:var(--text-dim,#93a0b8);--mp-accent:var(--accent-blue-bright,#17abe8);--mp-line:var(--line,rgba(220,230,245,.1));--mp-radius:22px}
    html,body{width:100%;height:100%;min-width:0;min-height:0;margin:0;overflow:hidden;background:var(--mp-bg)!important;color:var(--mp-text);font-family:var(--sans,Inter,Segoe UI,system-ui,sans-serif)}
    body.mp-v3-active{display:block!important;background:var(--mp-bg)!important}
    .mini-shell.mp-v3{position:relative;width:100vw;height:100vh;min-width:0;min-height:0;padding:clamp(18px,3.2vw,38px);box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(ellipse at 50% 7%,color-mix(in srgb,var(--mp-accent) 15%,transparent),transparent 58%),linear-gradient(145deg,var(--mp-bg),color-mix(in srgb,var(--mp-bg) 90%,var(--mp-card)));}
    .mini-shell.mp-v3 .mini-card{position:relative;z-index:1;width:min(440px,calc(100vw - 42px));height:min(700px,calc(100vh - 42px));max-width:100%;max-height:100%;min-width:0;min-height:0;margin:0;border:1px solid var(--mp-line);border-radius:var(--mp-radius);overflow:hidden;background:linear-gradient(155deg,color-mix(in srgb,var(--mp-card) 96%,white 4%),color-mix(in srgb,var(--mp-bg) 94%,black 6%));box-shadow:var(--shadow-lift,0 24px 70px rgba(0,0,0,.52)),0 2px 12px rgba(0,0,0,.22),inset 0 1px rgba(255,255,255,.06);display:flex;flex-direction:column;flex:0 1 auto;transition:width .24s cubic-bezier(.2,.8,.2,1),height .24s cubic-bezier(.2,.8,.2,1),border-radius .2s ease,box-shadow .2s ease;}
    .mini-shell.mp-v3.mp-frame-expanded{padding:14px}.mini-shell.mp-v3.mp-frame-expanded .mini-card{width:min(650px,64vh,calc(100vw - 28px));height:min(900px,calc(100vh - 28px));}
    .mini-shell.mp-v3 .mp-toolbar{height:46px;min-height:46px;flex:0 0 46px;display:flex;align-items:center;gap:7px;padding:0 13px;border-bottom:1px solid var(--mp-line);background:rgba(0,0,0,.08);-webkit-app-region:drag}
    .mini-shell.mp-v3 .mp-brand{font-size:10px;font-weight:800;letter-spacing:.17em;color:var(--mp-muted);white-space:nowrap;margin-right:auto}
    .mini-shell.mp-v3 .mp-toolbar button,.mini-shell.mp-v3 .mp-action{appearance:none;-webkit-app-region:no-drag;border:1px solid var(--mp-line);background:color-mix(in srgb,var(--mp-card) 78%,transparent);color:var(--mp-text);border-radius:9px;min-width:30px;height:30px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;font:600 11px var(--sans,Inter,Segoe UI,system-ui,sans-serif);white-space:nowrap;cursor:pointer;transition:background .15s ease,border-color .15s ease,transform .15s ease}
    .mini-shell.mp-v3 .mp-toolbar button:hover,.mini-shell.mp-v3 .mp-action:hover{background:color-mix(in srgb,var(--mp-accent) 19%,var(--mp-card));border-color:color-mix(in srgb,var(--mp-accent) 55%,var(--mp-line))}
    .mini-shell.mp-v3 .mp-toolbar button:active,.mini-shell.mp-v3 .mp-action:active{transform:scale(.96)}
    .mini-shell.mp-v3 button:focus-visible,.mini-shell.mp-v3 input:focus-visible,.mini-shell.mp-v3 select:focus-visible{outline:2px solid var(--mp-accent);outline-offset:2px}
    .mini-shell.mp-v3 .mp-toolbar .mp-close{font-size:17px;padding:0 10px;color:var(--mp-muted)}
    .mini-shell.mp-v3 .mini-panel{position:absolute;z-index:30;left:clamp(14px,calc(50% - 650px),120px);top:50%;bottom:auto;width:min(280px,calc(100vw - 28px));height:min(650px,calc(100vh - 44px));padding:13px;background:color-mix(in srgb,var(--mp-panel) 96%,transparent);border:1px solid var(--mp-line);border-radius:16px;box-shadow:0 22px 66px rgba(0,0,0,.52);backdrop-filter:blur(22px);transform:translate(calc(-100% - 24px),-50%);opacity:0;pointer-events:none;transition:transform .2s ease,opacity .2s ease;display:flex;flex-direction:column;}
    .mini-shell.mp-v3 .mini-panel:not(.collapsed){transform:translate(0,-50%);opacity:1;pointer-events:auto}
    .mini-shell.mp-v3 .mini-panel-header{display:flex;align-items:center;justify-content:space-between;padding:0 0 10px;margin:0 0 9px;border-bottom:1px solid var(--mp-line);gap:8px}
    .mini-shell.mp-v3 .mini-panel-tabs{display:flex;gap:5px;min-width:0;flex:1}
    .mini-shell.mp-v3 .mp-panel-tab{height:30px;padding:0 9px;border:1px solid var(--mp-line);border-radius:8px;background:transparent;color:var(--mp-muted);font:600 10px var(--sans,Inter,Segoe UI,system-ui,sans-serif);cursor:pointer;white-space:nowrap}
    .mini-shell.mp-v3 .mp-panel-tab.active{background:color-mix(in srgb,var(--mp-accent) 20%,transparent);border-color:color-mix(in srgb,var(--mp-accent) 54%,var(--mp-line));color:var(--mp-text)}
    .mini-shell.mp-v3 .mini-panel-toggle{display:none}
    .mini-shell.mp-v3 .mini-panel-breadcrumb{padding:0 4px 9px;color:var(--mp-muted)}
    .mini-shell.mp-v3 .mini-playlist-list{display:flex;flex:1;min-height:0;flex-direction:column;gap:7px;overflow:auto;padding:1px 2px 2px 0;}
    .mini-shell.mp-v3 .mini-playlist-btn{border-radius:10px;border-color:var(--mp-line);background:rgba(255,255,255,.025);color:var(--mp-text)}
    .mini-shell.mp-v3 .mini-playlist-btn:hover,.mini-shell.mp-v3 .mini-playlist-btn.active{background:color-mix(in srgb,var(--mp-accent) 16%,transparent);border-color:color-mix(in srgb,var(--mp-accent) 40%,var(--mp-line))}
    .mini-shell.mp-v3 .mini-panel-empty{color:var(--mp-muted)}
    .mini-shell.mp-v3 .mini-art-wrap{position:relative;flex:1 1 auto;width:100%;min-height:170px;max-height:none;overflow:hidden;background:var(--mp-bg)}
    .mini-shell.mp-v3 .mini-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;filter:saturate(1.08) contrast(1.03)}
    .mini-shell.mp-v3 .mini-overlay{display:none}
    .mini-shell.mp-v3 .mp-track-info{padding:15px 18px 7px;min-width:0;display:flex;flex-direction:column;gap:5px}
    .mini-shell.mp-v3 .mini-title{font:750 clamp(19px,4.7vw,27px)/1.08 var(--mp-player-font,var(--sans,Inter,Segoe UI,system-ui,sans-serif));letter-spacing:-.035em;color:var(--mp-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mini-shell.mp-v3 .mini-sub{margin:0;display:flex;align-items:center;gap:7px;color:var(--mp-muted);font-size:12px;letter-spacing:.01em;text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mini-shell.mp-v3 .mini-sub .dot{width:4px;height:4px;background:var(--mp-accent);flex:0 0 4px}
    .mini-shell.mp-v3 .mini-meta{display:block;margin:0;color:var(--mp-muted);font-size:11px;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mini-shell.mp-v3 .mp-timeline{padding:3px 18px 9px;display:grid;grid-template-columns:36px minmax(0,1fr) 36px;gap:8px;align-items:center}
    .mini-shell.mp-v3 .mp-time{font:10px tabular-nums var(--mono,Consolas,monospace);color:var(--mp-muted)}
    .mini-shell.mp-v3 .mp-time:last-child{text-align:right}
    .mini-shell.mp-v3 #mpSeek{width:100%;height:16px;margin:0;accent-color:var(--mp-accent);cursor:pointer;min-width:0}
    .mini-shell.mp-v3 .mini-controls{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 15px 16px;background:rgba(0,0,0,.12);border-top:1px solid var(--mp-line)}
    .mini-shell.mp-v3 .mini-left,.mini-shell.mp-v3 .mini-right{display:flex;align-items:center;gap:8px;min-width:0}
    .mini-shell.mp-v3 .mini-btn{width:35px;height:35px;border:1px solid var(--mp-line);background:rgba(255,255,255,.055);color:var(--mp-text)}
    .mini-shell.mp-v3 .mini-btn.primary{width:44px;height:44px;border:0;background:var(--mp-accent);color:#07111c;box-shadow:0 4px 16px color-mix(in srgb,var(--mp-accent) 28%,transparent)}
    .mini-shell.mp-v3 .mini-btn.primary svg{width:19px;height:19px}
    .mini-shell.mp-v3 .mini-volume{width:clamp(58px,18vw,95px);accent-color:var(--mp-accent)}
    .mini-shell.mp-v3 .mp-mode-active{background:color-mix(in srgb,var(--mp-accent) 22%,transparent)!important;border-color:var(--mp-accent)!important;color:var(--mp-text)!important}
    .mini-shell.mp-v3 .mp-lyrics-screen{display:none;flex:1 1 auto;min-height:130px;overflow:hidden;padding:12px 20px 14px;flex-direction:column;gap:9px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--mp-bg) 34%,transparent))}
    .mini-shell.mp-v3 .mp-lyrics-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--mp-muted);font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
    .mini-shell.mp-v3 .mp-lyrics-status{font-size:10px;font-weight:500;letter-spacing:.02em;text-transform:none}
    .mini-shell.mp-v3 .mp-lyrics-lines{overflow:auto;min-height:0;flex:1;scrollbar-width:thin;scrollbar-color:var(--mp-accent) transparent;padding:4px 10px 18px 0}
    .mini-shell.mp-v3 .mp-lyric-line{padding:6px 0;color:var(--mp-muted);font-size:clamp(14px,2.7vw,18px);line-height:1.42;transition:color .18s ease,transform .18s ease,font-size .18s ease;white-space:pre-wrap;overflow-wrap:anywhere}
    .mini-shell.mp-v3 .mp-lyric-line.active{color:var(--mp-text);font-size:clamp(17px,3.1vw,22px);font-weight:750;transform:translateX(4px);text-shadow:0 0 22px color-mix(in srgb,var(--mp-accent) 22%,transparent)}
    .mini-shell.mp-v3 .mp-lyrics-empty{color:var(--mp-muted);font-size:13px;line-height:1.6;padding:18px 0}
    .mini-shell.mp-v3 .mp-lyrics-edit{margin-top:9px;height:30px;padding:0 10px;border:1px solid var(--mp-line);border-radius:8px;background:transparent;color:var(--mp-text);cursor:pointer}
    .mini-shell.mp-v3 .mp-eq-panel{display:flex;flex:1;min-height:0;flex-direction:column;gap:9px;padding:1px 1px 6px}
    .mini-shell.mp-v3 .mp-eq-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:end;position:sticky;top:0;background:color-mix(in srgb,var(--mp-panel) 96%,transparent);padding:2px 0 8px;z-index:1}
    .mini-shell.mp-v3 .mp-eq-preset-label{display:flex;flex-direction:column;gap:5px;color:var(--mp-muted);font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    .mini-shell.mp-v3 .mp-eq-preset{width:100%;height:32px;padding:0 9px;border:1px solid var(--mp-line);border-radius:8px;background:var(--mp-bg);color:var(--mp-text);font:12px var(--sans,Inter,Segoe UI,system-ui,sans-serif)}
    .mini-shell.mp-v3 .mp-eq-reset{height:32px;padding:0 11px;border:1px solid var(--mp-line);border-radius:8px;background:rgba(255,255,255,.04);color:var(--mp-text);font:600 11px var(--sans,Inter,Segoe UI,system-ui,sans-serif);cursor:pointer}
    .mini-shell.mp-v3 .mp-eq-note{color:var(--mp-muted);font-size:10px;line-height:1.45;margin-bottom:2px}
    .mini-shell.mp-v3 .mp-eq-bands{display:flex;flex-direction:column;gap:5px;overflow:auto;min-height:0;padding-right:4px}
    .mini-shell.mp-v3 .mp-eq-band{display:grid;grid-template-columns:45px minmax(0,1fr) 43px;align-items:center;gap:8px;min-height:23px;color:var(--mp-text);font-size:10px}
    .mini-shell.mp-v3 .mp-eq-band-name{color:var(--mp-muted);font-variant-numeric:tabular-nums}
    .mini-shell.mp-v3 .mp-eq-band input{width:100%;min-width:0;height:17px;margin:0;accent-color:var(--mp-accent);cursor:pointer}
    .mini-shell.mp-v3 .mp-eq-band-value{text-align:right;color:var(--mp-muted);font:10px var(--mono,Consolas,monospace)}
    .mini-shell.mp-v3.mp-show-lyrics .mini-art-wrap{display:none}
    .mini-shell.mp-v3.mp-show-lyrics .mp-lyrics-screen{display:flex}
    .mini-shell.mp-v3.style-glass .mini-card{background:color-mix(in srgb,var(--mp-card) 70%,transparent);backdrop-filter:blur(24px);border-color:color-mix(in srgb,var(--mp-accent) 25%,var(--mp-line))}
    .mini-shell.mp-v3.style-flat .mini-card{box-shadow:none}
    .mini-shell.mp-v3.style-outline .mini-card{background:transparent;border:1px solid color-mix(in srgb,var(--mp-accent) 48%,var(--mp-line));box-shadow:none}
    body.no-card-lift .mini-shell.mp-v3 .mini-card{box-shadow:none}
    body.reduce-motion .mini-shell.mp-v3 *{transition:none!important;animation:none!important}
    body.bold-titles .mini-shell.mp-v3 .mini-title{font-weight:850}
    body.theme-paper .mini-shell.mp-v3{color-scheme:light}
    body.theme-paper .mini-shell.mp-v3 .mini-card{background:linear-gradient(155deg,var(--mp-card),var(--mp-bg));}
    body.theme-paper .mini-shell.mp-v3 .mini-btn.primary{color:white}
    body.high-contrast .mini-shell.mp-v3 .mini-card,body.high-contrast .mini-shell.mp-v3 .mini-panel{border-color:color-mix(in srgb,var(--mp-text) 45%,transparent)}
    @media(max-width:520px){.mini-shell.mp-v3 .mp-brand{display:none}.mini-shell.mp-v3 .mp-toolbar{gap:5px;padding:0 8px}.mini-shell.mp-v3 .mp-toolbar button{padding:0 7px;font-size:10px}} @media(max-width:360px){.mini-shell.mp-v3 #mpMainBtn{display:none}}
    @media(max-height:420px){.mini-shell.mp-v3 .mini-card{height:calc(100vh - 20px)}.mini-shell.mp-v3 .mini-art-wrap{min-height:90px}.mini-shell.mp-v3 .mini-controls{padding-top:5px;padding-bottom:7px}.mini-shell.mp-v3 .mp-lyrics-screen{min-height:75px}}
    @media(prefers-reduced-motion:reduce){.mini-shell.mp-v3 *{transition:none!important;animation:none!important}}
  `;
  document.head.appendChild(style);
  document.body.classList.add('mp-v3-active');
  shell.classList.add('mp-v3');
  panel.classList.add('collapsed');

  const prefs = readPrefs();
  let frameExpanded = prefs.frameExpanded === true;
  let lyricsVisible = prefs.lyricsVisible === true;
  let panelView = 'library';
  let lastState = readState();
  let lastStateReceivedAt = Date.now();
  let seekWasEdited = false;
  let activeLyricIndex = -1;
  let lyricTrackId = null;
  let lyricDb = null;
  let lyricLines = [];
  let lyricTimed = false;
  let lyricFetchToken = 0;
  let panelRenderQueued = false;

  const makeButton = (id, label, hint, caption) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'mp-action';
    button.setAttribute('aria-label', label);
    button.title = hint || label;
    button.textContent = caption;
    return button;
  };

  // Keep a compact, consistent control strip in the floating card.
  const toolbar = document.createElement('div');
  toolbar.className = 'mp-toolbar';
  const brand = document.createElement('span');
  brand.className = 'mp-brand';
  brand.textContent = 'SLEEVE MINI';
  const libraryButton = makeButton('mpLibraryBtn', 'Open library panel', 'Browse playlists and artists', 'Library');
  const eqButton = makeButton('mpEqBtn', 'Open MiniPlayer equalizer', 'Open the equalizer inside this MiniPlayer', 'EQ');
  const lyricsButton = makeButton('mpLyricsBtn', 'Show lyrics', 'Switch the card to lyrics', 'Lyrics');
  const frameButton = makeButton('mpFrameBtn', 'Expand card frame', 'Expand the floating card while keeping it centered', 'Expand');
  const mainButton = makeButton('mpMainBtn', 'Focus main Sleeve window', 'Focus the main Sleeve window', 'Sleeve');
  const closeButton = makeButton('mpCloseBtn', 'Close MiniPlayer', 'Close MiniPlayer', '×');
  closeButton.classList.add('mp-close');
  toolbar.append(brand, libraryButton, eqButton, lyricsButton, frameButton, mainButton, closeButton);
  card.insertBefore(toolbar, artWrap);

  // Move track metadata out of the artwork overlay, leaving the art clean.
  const trackInfo = document.createElement('div');
  trackInfo.className = 'mp-track-info';
  trackInfo.append(title, subtitle);
  if (meta) trackInfo.append(meta);
  if (overlay) overlay.remove();
  card.insertBefore(trackInfo, controls);

  const timeline = document.createElement('div');
  timeline.className = 'mp-timeline';
  const currentTimeNode = document.createElement('span');
  currentTimeNode.className = 'mp-time';
  currentTimeNode.id = 'mpCurrentTime';
  currentTimeNode.textContent = '0:00';
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.id = 'mpSeek';
  seek.min = '0';
  seek.max = '1000';
  seek.step = '1';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Seek through the current track');
  const durationNode = document.createElement('span');
  durationNode.className = 'mp-time';
  durationNode.id = 'mpDurationTime';
  durationNode.textContent = '0:00';
  timeline.append(currentTimeNode, seek, durationNode);
  card.insertBefore(timeline, controls);

  const lyricsScreen = document.createElement('section');
  lyricsScreen.className = 'mp-lyrics-screen';
  lyricsScreen.id = 'mpLyricsScreen';
  lyricsScreen.innerHTML = '<div class="mp-lyrics-heading"><span>Now Playing · Lyrics</span><span class="mp-lyrics-status" id="mpLyricsStatus">Waiting for lyrics…</span></div><div class="mp-lyrics-lines" id="mpLyricsLines" aria-live="polite"></div>';
  card.insertBefore(lyricsScreen, timeline);
  const lyricsLinesNode = byId('mpLyricsLines');
  const lyricsStatusNode = byId('mpLyricsStatus');

  // Add shuffle/repeat to the existing transport row; actions are sent to the
  // original renderer, which remains the sole owner of playback.
  const shuffleButton = makeButton('mpShuffleBtn', 'Toggle shuffle', 'Toggle shuffle', '⇄');
  const repeatButton = makeButton('mpRepeatBtn', 'Cycle repeat mode', 'Cycle repeat mode', '↻');
  leftControls.insertBefore(shuffleButton, leftControls.firstChild);
  leftControls.insertBefore(repeatButton, shuffleButton.nextSibling);

  // Turn the existing library drawer into a three-view panel. The original
  // playlist and artist buttons are retained (detached) so their existing
  // browsing logic keeps working without a second library implementation.
  const tabHost = panel.querySelector('.mini-panel-tabs');
  if (tabHost) {
    tabHost.innerHTML = '';
    const makePanelTab = (id, label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = id;
      button.className = 'mp-panel-tab';
      button.textContent = label;
      tabHost.appendChild(button);
      return button;
    };
    const playlistsTab = makePanelTab('mpTabPlaylists', 'Playlists');
    const artistsTab = makePanelTab('mpTabArtists', 'Artists');
    const eqTab = makePanelTab('mpTabEq', 'Equalizer');

    const setPanelTabActive = (key) => {
      playlistsTab.classList.toggle('active', key === 'playlists');
      artistsTab.classList.toggle('active', key === 'artists');
      eqTab.classList.toggle('active', key === 'eq');
    };

    const openPanel = (key) => {
      panel.classList.remove('collapsed');
      if (panelToggle) panelToggle.textContent = '×';
      panelView = key;
      setPanelTabActive(key);
      if (key === 'playlists') legacyPlaylistTab.click();
      else if (key === 'artists') legacyArtistsTab.click();
      else renderEqualizerPanel();
      libraryButton.classList.toggle('mp-mode-active', key !== 'eq');
      eqButton.classList.toggle('mp-mode-active', key === 'eq');
    };
    playlistsTab.addEventListener('click', () => openPanel('playlists'));
    artistsTab.addEventListener('click', () => openPanel('artists'));
    eqTab.addEventListener('click', () => openPanel('eq'));
    libraryButton.addEventListener('click', () => {
      const alreadyOpen = !panel.classList.contains('collapsed') && panelView !== 'eq';
      if (alreadyOpen) {
        panel.classList.add('collapsed');
        libraryButton.classList.remove('mp-mode-active');
      } else openPanel('playlists');
    });
    eqButton.addEventListener('click', () => {
      const alreadyOpen = !panel.classList.contains('collapsed') && panelView === 'eq';
      if (alreadyOpen) {
        panel.classList.add('collapsed');
        eqButton.classList.remove('mp-mode-active');
      } else openPanel('eq');
    });
  }

  if (panelToggle) {
    panelToggle.addEventListener('click', () => {
      const willClose = !panel.classList.contains('collapsed');
      panel.classList.toggle('collapsed', willClose);
      if (willClose) {
        libraryButton.classList.remove('mp-mode-active');
        eqButton.classList.remove('mp-mode-active');
      }
    });
  }

  const setFrameExpanded = (expanded) => {
    frameExpanded = !!expanded;
    shell.classList.toggle('mp-frame-expanded', frameExpanded);
    frameButton.textContent = frameExpanded ? 'Restore' : 'Expand';
    frameButton.title = frameExpanded ? 'Restore the floating card size' : 'Expand the floating card while keeping it centered';
    frameButton.setAttribute('aria-label', frameExpanded ? 'Restore card frame' : 'Expand card frame');
    writePrefs();
  };
  const setLyricsVisible = (visible) => {
    lyricsVisible = !!visible;
    shell.classList.toggle('mp-show-lyrics', lyricsVisible);
    lyricsButton.classList.toggle('mp-mode-active', lyricsVisible);
    lyricsButton.textContent = lyricsVisible ? 'Artwork' : 'Lyrics';
    lyricsButton.title = lyricsVisible ? 'Return to artwork' : 'Switch the card to lyrics';
    writePrefs();
    if (lyricsVisible) refreshLyrics(true);
  };

  frameButton.addEventListener('click', () => setFrameExpanded(!frameExpanded));
  lyricsButton.addEventListener('click', () => setLyricsVisible(!lyricsVisible));
  mainButton.addEventListener('click', () => {
    try { if (window.opener && !window.opener.closed) window.opener.focus(); } catch (_) {}
  });
  closeButton.addEventListener('click', () => window.close());
  shuffleButton.addEventListener('click', () => clickMainControl('shuffleBtn'));
  repeatButton.addEventListener('click', () => clickMainControl('repeatBtn'));

  // Mirror the user's actual Customize settings and active style preset. The
  // app computes the final colors in :root; copying those computed tokens
  // ensures custom accents, themes, and CSS overrides carry into the popup.
  const themeTokens = [
    '--bg','--bg-sidebar','--bg-elevated','--bg-elevated-2','--bg-card','--bg-card-hover',
    '--text','--text-dim','--text-dimmer','--accent-blue','--accent-blue-bright','--accent-ice',
    '--line','--line-bright','--shadow-card','--shadow-lift','--radius-card','--radius-thumb','--radius-preview'
  ];
  const mirroredBodyClasses = [
    'style-glass','style-flat','style-outline','compact-cards','no-card-lift','soft-atmosphere',
    'high-contrast','patterned-page','theme-paper','thumbnail-fit','font-sans','reduce-motion',
    'row-compact','bold-titles','active-glow','sidebar-blur','top-page-navigation',
    'preset-sleeve','preset-spotify','preset-amazonMusic'
  ];
  const syncAppearance = () => {
    const doc = mainDocument();
    if (!doc) return;
    try {
      const styles = window.opener.getComputedStyle(doc.documentElement);
      themeTokens.forEach((token) => {
        const value = styles.getPropertyValue(token).trim();
        if (value) document.documentElement.style.setProperty(token, value);
      });
      mirroredBodyClasses.forEach((className) => {
        document.body.classList.toggle(className, doc.body.classList.contains(className));
        shell.classList.toggle(className, doc.body.classList.contains(className));
      });
      const settings = safeJson(localStorage.getItem(SETTINGS_KEY), {});
      const radius = Number(settings.radius);
      if (Number.isFinite(radius)) shell.style.setProperty('--mp-radius', `${clamp(radius, 4, 30)}px`);
      const bodyStyles = window.opener.getComputedStyle(doc.body);
      if (bodyStyles.fontFamily) document.body.style.fontFamily = bodyStyles.fontFamily;
      const font = settings.font === 'sans'
        ? 'Inter, Segoe UI, system-ui, sans-serif'
        : 'Georgia, Iowan Old Style, Times New Roman, serif';
      if (settings.font) shell.style.setProperty('--mp-player-font', font);
      card.style.boxShadow = settings.cardShadow === false ? 'none' : '';
      if (settings.hairlines === false) shell.style.setProperty('--mp-line', 'transparent');
      else shell.style.removeProperty('--mp-line');
      if (settings.noCardLift) card.style.transform = 'none';
      else card.style.removeProperty('transform');
    } catch (_) {}
  };

  // --- In-window equalizer, bridged to Sleeve's existing EQ sliders/presets. ---
  const getMainEq = () => {
    const doc = mainDocument();
    if (!doc) return null;
    return {
      doc,
      sliders: Array.from(doc.querySelectorAll('#eqGrid [data-eq-index]')),
      preset: doc.getElementById('eqPreset'),
      reset: doc.getElementById('eqReset')
    };
  };
  const dispatchMain = (node, type) => {
    const opener = window.opener;
    if (!node || !opener) return false;
    try {
      node.dispatchEvent(new opener.Event(type, { bubbles: true }));
      return true;
    } catch (_) {
      try {
        const event = opener.document.createEvent('HTMLEvents');
        event.initEvent(type, true, false);
        node.dispatchEvent(event);
        return true;
      } catch (_) { return false; }
    }
  };
  const syncEqFromMain = () => {
    if (panelView !== 'eq') return;
    const mainEq = getMainEq();
    const eqPanel = miniList.querySelector('.mp-eq-panel');
    if (!mainEq || !eqPanel) return;
    const preset = eqPanel.querySelector('#mpEqPreset');
    if (preset && mainEq.preset && document.activeElement !== preset) preset.value = mainEq.preset.value;
    mainEq.sliders.forEach((mainSlider) => {
      const index = Number(mainSlider.dataset.eqIndex);
      const miniSlider = eqPanel.querySelector(`[data-mp-eq-index="${index}"]`);
      const valueNode = eqPanel.querySelector(`[data-mp-eq-value="${index}"]`);
      if (!miniSlider) return;
      if (document.activeElement !== miniSlider) miniSlider.value = mainSlider.value;
      if (valueNode) valueNode.textContent = `${Number(mainSlider.value) > 0 ? '+' : ''}${mainSlider.value} dB`;
    });
  };
  function renderEqualizerPanel() {
    const mainEq = getMainEq();
    miniBreadcrumb.style.display = 'none';
    if (!mainEq || !mainEq.sliders.length) {
      miniList.innerHTML = '<div class="mini-panel-empty">Sleeve’s equalizer is not ready yet. Reopen this panel after the main player has loaded.</div>';
      return;
    }
    const options = mainEq.preset
      ? Array.from(mainEq.preset.options).map((option) => `<option value="${String(option.value).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${String(option.textContent).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</option>`).join('')
      : '<option value="custom">Custom</option>';
    const rows = mainEq.sliders.map((mainSlider) => {
      const index = Number(mainSlider.dataset.eqIndex);
      const label = mainSlider.closest('.eq-band')?.querySelector('.eq-band-name')?.textContent || `${index + 1}`;
      const value = Number(mainSlider.value) || 0;
      return `<label class="mp-eq-band"><span class="mp-eq-band-name">${label}</span><input type="range" min="-12" max="12" step="1" value="${value}" data-mp-eq-index="${index}" aria-label="${label}"><output class="mp-eq-band-value" data-mp-eq-value="${index}">${value > 0 ? '+' : ''}${value} dB</output></label>`;
    }).join('');
    miniList.innerHTML = `<div class="mp-eq-panel"><div class="mp-eq-top"><label class="mp-eq-preset-label">Preset<select class="mp-eq-preset" id="mpEqPreset">${options}</select></label><button class="mp-eq-reset" id="mpEqReset" type="button">Reset</button></div><div class="mp-eq-note">These sliders adjust Sleeve’s active equalizer and are saved with your existing EQ settings.</div><div class="mp-eq-bands">${rows}</div></div>`;
    const preset = miniList.querySelector('#mpEqPreset');
    if (preset && mainEq.preset) {
      preset.value = mainEq.preset.value;
      preset.addEventListener('change', () => {
        const current = getMainEq();
        if (!current || !current.preset) return;
        current.preset.value = preset.value;
        dispatchMain(current.preset, 'change');
        window.setTimeout(syncEqFromMain, 30);
      });
    }
    miniList.querySelector('#mpEqReset')?.addEventListener('click', () => {
      const current = getMainEq();
      if (current?.reset) {
        current.reset.click();
        window.setTimeout(syncEqFromMain, 30);
      }
    });
    miniList.querySelectorAll('[data-mp-eq-index]').forEach((miniSlider) => {
      miniSlider.addEventListener('input', () => {
        const current = getMainEq();
        const index = Number(miniSlider.dataset.mpEqIndex);
        const source = current && current.sliders.find((slider) => Number(slider.dataset.eqIndex) === index);
        if (!source) return;
        source.value = miniSlider.value;
        dispatchMain(source, 'input');
        const valueNode = miniList.querySelector(`[data-mp-eq-value="${index}"]`);
        if (valueNode) valueNode.textContent = `${Number(miniSlider.value) > 0 ? '+' : ''}${miniSlider.value} dB`;
      });
    });
    syncEqFromMain();
  }

  // --- Lyrics: load the active track's saved text from Sleeve's existing DB. ---
  const openLyricsDatabase = () => {
    if (lyricDb) return Promise.resolve(lyricDb);
    const opener = window.opener;
    if (!opener || opener.closed || !opener.indexedDB) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const request = opener.indexedDB.open(DB_NAME);
        request.onsuccess = () => {
          lyricDb = request.result;
          if (!lyricDb.objectStoreNames.contains(STORE_NAME)) {
            lyricDb.close();
            lyricDb = null;
          }
          resolve(lyricDb);
        };
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  };
  const readTrackLyrics = async (id) => {
    const db = await openLyricsDatabase();
    if (!db || !id) return null;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  };
  const parseLyricText = (raw) => {
    const timedLines = [];
    const plainLines = [];
    const timeTag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    String(raw || '').split(/\r?\n/).forEach((line) => {
      const tags = Array.from(line.matchAll(timeTag));
      const text = line.replace(timeTag, '').trim();
      if (!text) return;
      if (tags.length) {
        tags.forEach((tag) => {
          const fraction = tag[3] ? Number(`0.${tag[3].padEnd(3, '0').slice(0, 3)}`) : 0;
          timedLines.push({ time: Number(tag[1]) * 60 + Number(tag[2]) + fraction, text });
        });
      } else plainLines.push({ time: null, text });
    });
    if (timedLines.length) return { timed: true, lines: timedLines.sort((a, b) => a.time - b.time) };
    return { timed: false, lines: plainLines };
  };
  const currentPosition = () => {
    const base = Math.max(0, Number(lastState.currentTime) || 0);
    if (!lastState.isPlaying) return base;
    const elapsed = Math.max(0, (Date.now() - lastStateReceivedAt) / 1000);
    return clamp(base + elapsed * Math.max(0.25, Number(lastState.speed) || 1), 0, Number(lastState.duration) || base + elapsed);
  };
  const renderLyrics = () => {
    const currentTime = currentPosition();
    const nextActive = lyricTimed ? lyricLines.reduce((found, line, index) => line.time <= currentTime ? index : found, -1) : -1;
    if (!lyricLines.length) {
      lyricsLinesNode.innerHTML = '<div class="mp-lyrics-empty">No saved lyrics were found for this track. Add lyrics in Sleeve’s lyrics editor and they will appear here automatically.</div>';
      safeText(lyricsStatusNode, 'No lyrics saved');
      activeLyricIndex = -1;
      return;
    }
    if (lyricsLinesNode.childElementCount !== lyricLines.length) {
      lyricsLinesNode.replaceChildren();
      lyricLines.forEach((line) => {
        const node = document.createElement('div');
        node.className = 'mp-lyric-line';
        node.textContent = line.text;
        lyricsLinesNode.appendChild(node);
      });
      activeLyricIndex = -1;
    }
    if (lyricTimed) safeText(lyricsStatusNode, 'Synced lyrics');
    else safeText(lyricsStatusNode, 'Plain lyrics');
    if (nextActive !== activeLyricIndex) {
      const children = Array.from(lyricsLinesNode.children);
      children.forEach((node, index) => node.classList.toggle('active', index === nextActive));
      if (nextActive >= 0 && children[nextActive]) children[nextActive].scrollIntoView({ block: 'center', behavior: 'smooth' });
      activeLyricIndex = nextActive;
    }
  };
  async function refreshLyrics(force) {
    if (!lyricsVisible) return;
    const id = lastState.id;
    if (!id) {
      lyricTrackId = null;
      lyricLines = [];
      lyricTimed = false;
      safeText(lyricsStatusNode, 'Nothing playing');
      renderLyrics();
      return;
    }
    if (!force && lyricTrackId === id && lyricLines.length) {
      renderLyrics();
      return;
    }
    if (lyricTrackId !== id) {
      lyricTrackId = id;
      lyricLines = [];
      lyricTimed = false;
      activeLyricIndex = -1;
      safeText(lyricsStatusNode, 'Loading lyrics…');
    }
    const token = ++lyricFetchToken;
    const track = await readTrackLyrics(id);
    if (token !== lyricFetchToken || !lyricsVisible || lastState.id !== id) return;
    const parsed = parseLyricText(track?.lyrics || '');
    lyricLines = parsed.lines;
    lyricTimed = parsed.timed;
    renderLyrics();
  }

  const updatePosition = () => {
    const state = lastState || {};
    const position = currentPosition();
    const duration = Math.max(0, Number(state.duration) || 0);
    const percent = duration > 0 ? clamp(position / duration, 0, 1) : 0;
    safeText(currentTimeNode, formatTime(position));
    safeText(durationNode, formatTime(duration));
    if (!seekWasEdited) seek.value = String(Math.round(percent * 1000));
    seek.disabled = !duration;
    if (progressFill) progressFill.style.width = `${percent * 100}%`;
    if (lyricsVisible && lyricTimed) renderLyrics();
  };
  const syncMainModes = () => {
    const doc = mainDocument();
    if (!doc) return;
    const shuffle = doc.getElementById('shuffleBtn');
    const repeat = doc.getElementById('repeatBtn');
    const shuffleOn = !!(shuffle && /on|active|enabled/i.test(`${shuffle.title} ${shuffle.className}`));
    const repeatOn = !!(repeat && !/off/i.test(repeat.title || ''));
    shuffleButton.classList.toggle('mp-mode-active', shuffleOn);
    repeatButton.classList.toggle('mp-mode-active', repeatOn);
    if (shuffle?.title) shuffleButton.title = shuffle.title;
    if (repeat?.title) repeatButton.title = repeat.title;
  };
  const updateArtwork = (state) => {
    const url = typeof state.thumbUrl === 'string' ? state.thumbUrl.trim() : '';
    if (!art) return;
    if (!url) {
      if (art.tagName === 'IMG') art.removeAttribute('src');
      art.style.background = 'linear-gradient(135deg,var(--bg-elevated,#273346),var(--bg,#101722))';
      if (art.tagName !== 'IMG') art.textContent = '♪';
      return;
    }
    try {
      const parsed = new URL(url, window.location.href);
      if (!['http:', 'https:', 'file:', 'blob:', 'data:'].includes(parsed.protocol)) return;
      if (parsed.protocol === 'data:' && !/^data:image\//i.test(url)) return;
      if (art.tagName === 'IMG') {
        art.alt = String(lastState.title || 'Album artwork');
        if (art.getAttribute('src') !== url) art.src = url;
      } else {
        art.style.background = `center / cover no-repeat url("${url.replace(/["\\]/g, '')}")`;
        art.textContent = '';
      }
    } catch (_) {}
  };
  const render = () => {
    const state = lastState || {};
    safeText(title, state.title || 'Nothing playing');
    const artistLabel = state.artist || (state.kind === 'video' ? 'Video' : 'Audio');
    safeText(subtitle, `${artistLabel} · ${state.isPlaying ? 'Playing' : 'Paused'}`);
    safeText(meta, [state.album, state.year, state.genre].filter(Boolean).join(' · '));
    if (meta) meta.style.display = meta.textContent ? '' : 'none';
    const icon = byId('miniPlayIcon');
    if (icon) icon.innerHTML = state.isPlaying
      ? '<path d="M7 5h3v14H7zm7 0h3v14h-3z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    if (volume && document.activeElement !== volume) volume.value = String(clamp(Number(state.volume ?? 1), 0, 1));
    updateArtwork(state);
    updatePosition();
    syncMainModes();
    if (lyricsVisible && lyricTrackId !== state.id) refreshLyrics(true);
  };
  const refreshState = () => {
    const next = readState();
    if (Number(next.updatedAt) !== Number(lastState.updatedAt) || next.id !== lastState.id) {
      lastState = next;
      lastStateReceivedAt = Date.now();
    }
    render();
  };

  seek.addEventListener('input', () => {
    seekWasEdited = true;
    const duration = Math.max(0, Number(lastState.duration) || 0);
    safeText(currentTimeNode, formatTime((Number(seek.value) / 1000) * duration));
  });
  seek.addEventListener('change', () => {
    const duration = Math.max(0, Number(lastState.duration) || 0);
    if (duration > 0) postAction('seek', (Number(seek.value) / 1000) * duration);
    seekWasEdited = false;
    refreshState();
  });
  seek.addEventListener('blur', () => { seekWasEdited = false; refreshState(); });
  // The original popup already forwards volume input to the main renderer;
  // keep that single handler so a slider movement is not sent twice.

  window.addEventListener('storage', (event) => {
    if (!event.key || event.key === STATE_KEY) refreshState();
    if (!event.key || event.key === SETTINGS_KEY) syncAppearance();
    if (!event.key || event.key === EQ_STATE_KEY) syncEqFromMain();
  });
  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'sleeve-main-player') refreshState();
  });
  window.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName?.toLowerCase() || '';
    if (['input','textarea','select','button'].includes(tag) || event.altKey || event.ctrlKey || event.metaKey) return;
    const duration = Math.max(0, Number(lastState.duration) || 0);
    const position = currentPosition();
    if (event.code === 'Space') { event.preventDefault(); postAction('togglePlay'); }
    else if (event.code === 'ArrowLeft' && duration) { event.preventDefault(); postAction('seek', clamp(position - 5, 0, duration)); }
    else if (event.code === 'ArrowRight' && duration) { event.preventDefault(); postAction('seek', clamp(position + 5, 0, duration)); }
    else if (event.code === 'ArrowUp') { event.preventDefault(); postAction('volume', clamp(Number(lastState.volume ?? 1) + .05, 0, 1)); }
    else if (event.code === 'ArrowDown') { event.preventDefault(); postAction('volume', clamp(Number(lastState.volume ?? 1) - .05, 0, 1)); }
    else if (event.key.toLowerCase() === 'l') setLyricsVisible(!lyricsVisible);
    else if (event.key.toLowerCase() === 'e') panelView === 'eq' ? panel.classList.toggle('collapsed') : (panel.classList.remove('collapsed'), renderEqualizerPanel(), eqButton.classList.add('mp-mode-active'));
  });

  // The legacy MiniPlayer refreshes its library drawer on every state update.
  // If that refresh overwrites an open EQ panel, restore our EQ content.
  const panelObserver = new MutationObserver(() => {
    if (panelView === 'eq' && !miniList.querySelector('.mp-eq-panel') && !panelRenderQueued) {
      panelRenderQueued = true;
      window.setTimeout(() => {
        panelRenderQueued = false;
        if (panelView === 'eq' && !miniList.querySelector('.mp-eq-panel')) renderEqualizerPanel();
      }, 0);
    }
  });
  panelObserver.observe(miniList, { childList: true, subtree: true });

  setFrameExpanded(frameExpanded);
  setLyricsVisible(lyricsVisible);
  syncAppearance();
  render();
  if (panel.classList.contains('collapsed')) {
    libraryButton.classList.remove('mp-mode-active');
    eqButton.classList.remove('mp-mode-active');
  }
  window.setInterval(refreshState, 250);
  window.setInterval(syncAppearance, 1100);
  window.setInterval(() => {
    if (panelView === 'eq') syncEqFromMain();
    if (lyricsVisible) refreshLyrics(false);
  }, 1400);
})();
