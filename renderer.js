/**
 * This file is loaded via the <script> tag in the index.html file and will
 * be executed in the renderer process for that window. No Node.js APIs are
 * available in this process because `nodeIntegration` is turned off and
 * `contextIsolation` is turned on. Use the contextBridge API in `preload.js`
 * to expose Node.js functionality from the main process.
 */

() => {}
const MINI_STATE_KEY = 'sleeveMiniPlayerState';
const isMiniPlayerWindow = new URLSearchParams(window.location.search).get('mini') === '1';

function readMiniState(){
  try {
    const raw = localStorage.getItem(MINI_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeMiniState(state){
  try { localStorage.setItem(MINI_STATE_KEY, JSON.stringify(state)); } catch (e) {}
}

if (isMiniPlayerWindow) {
  const state = readMiniState();

  // Builds the mini player's artist line and a secondary album/year/genre
  // line from whatever metadata the current track has, falling back to
  // the file kind (Audio/Video/FLAC) when no artist tag is present.
  function subAndMeta(s, fallback){
    const subtitleText = s.artist ? s.artist
      : (s.kind ? (s.kind === 'video' ? 'Video' : (s.kind === 'flac' ? 'FLAC audio' : 'Audio')) : fallback);
    const metaParts = [];
    if (s.album) metaParts.push(s.album);
    if (s.year) metaParts.push(String(s.year));
    if (s.genre) metaParts.push(s.genre);
    return { subtitleText, metaText: metaParts.join(' \u2022 ') };
  }

  const art = state.thumbUrl || '';
  const title = state.title || 'Nothing playing';
  const { subtitleText: sub, metaText } = subAndMeta(state, 'Nothing playing');
  const progress = state.duration ? Math.min(100, ((state.currentTime || 0) / state.duration) * 100) : 0;
  document.body.innerHTML = `
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; font-family: Inter, system-ui, sans-serif; background: #0a0a0d; color: #f4f7fb; }
      body { display: flex; align-items: center; justify-content: center; }
      .mini-shell {
        position: relative; width: 100vw; height: 100vh; overflow: hidden;
        background: radial-gradient(circle at top, rgba(255,255,255,0.06), transparent 35%), #0b0c0f;
        display: flex; align-items: center; justify-content: center;
      }
      .mini-panel {
        position: absolute; left: 0; top: 0; bottom: 0; width: 190px; background: rgba(9,10,12,0.82); border-right: 1px solid rgba(255,255,255,0.08);
        backdrop-filter: blur(14px); display: flex; flex-direction: column; padding: 14px 10px 12px; transition: transform 0.2s ease, opacity 0.2s ease;
        z-index: 3;
      }
      .mini-panel.collapsed { transform: translateX(-168px); opacity: 0.9; }
      .mini-panel-header {
        display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 4px; color: rgba(255,255,255,0.8);
      }
      .mini-panel-title { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
      .mini-panel-tabs { display: flex; gap: 6px; }
      .mini-tab-btn {
        border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.6);
        border-radius: 7px; padding: 5px 10px; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase;
        cursor: pointer; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
      }
      .mini-tab-btn:hover { color: rgba(255,255,255,0.85); }
      .mini-tab-btn.active { background: rgba(255,255,255,0.14); color: #fff; border-color: rgba(255,255,255,0.22); }
      .mini-panel-breadcrumb {
        display: flex; align-items: center; gap: 6px; padding: 0 4px 10px; font-size: 11px; color: rgba(255,255,255,0.55);
        white-space: nowrap; overflow: hidden;
      }
      .mini-panel-breadcrumb button {
        appearance: none; border: none; background: none; color: rgba(255,255,255,0.75); font-size: 11px; font-weight: 600;
        cursor: pointer; padding: 0; flex-shrink: 0;
      }
      .mini-panel-breadcrumb button:hover { color: #fff; }
      .mini-panel-breadcrumb span { overflow: hidden; text-overflow: ellipsis; }
      .mini-panel-empty { color: rgba(255,255,255,0.55); font-size: 11px; padding: 10px 8px; }
      .mini-panel-toggle { border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.8); border-radius: 8px; width: 24px; height: 24px; cursor: pointer; }
      .mini-playlist-list { display: flex; flex-direction: column; gap: 8px; overflow: auto; padding-right: 2px; }
      .mini-playlist-btn {
        width: 100%; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); color: rgba(255,255,255,0.82); border-radius: 10px;
        padding: 9px 10px; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: border-color 0.12s ease, background 0.12s ease, transform 0.12s ease;
      }
      .mini-playlist-btn:hover { background: rgba(255,255,255,0.06); }
      .mini-playlist-btn.active { border-color: rgba(255,255,255,0.28); background: rgba(255,255,255,0.09); }
      .mini-playlist-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mini-playlist-meta { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.56); }
      .mini-card {
        position: relative; width: min(100vw, 420px); height: min(100vh, 760px); max-height: 100vh; margin-left: 0;
        border-radius: 22px; overflow: hidden; background: linear-gradient(180deg, rgba(25,25,30,0.98), rgba(9,10,12,0.98));
        box-shadow: 0 24px 70px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        display: flex; flex-direction: column;
      }
      .mini-shell.expanded-panel .mini-card { margin-left: 0; }
      .mini-shell:not(.expanded-panel) .mini-card { margin-left: 0; }
      .mini-art-wrap {
        position: relative; flex: 1; min-height: 0; background: #121417;
      }
      .mini-art {
        position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: saturate(1.2) contrast(1.05);
        display: block;
      }
      .mini-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.16), rgba(0,0,0,0.62)); }
      .mini-overlay {
        position: absolute; inset: auto 0 0 0; padding: 18px 18px 14px; background: linear-gradient(180deg, transparent, rgba(4,5,6,0.78) 42%, rgba(4,5,6,0.92));
      }
      .mini-title {
        font-size: clamp(28px, 5vw, 40px); line-height: 0.92; margin: 0; font-weight: 800; letter-spacing: -0.05em;
        font-family: Georgia, 'Times New Roman', serif; color: #f6f7fb; text-shadow: 0 4px 14px rgba(0,0,0,0.45);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mini-sub {
        margin-top: 8px; display: flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.72);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mini-sub .dot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,0.7); }
      .mini-meta {
        margin-top: 4px; font-size: 11px; letter-spacing: 0.05em; color: rgba(255,255,255,0.52);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mini-controls {
        display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px 18px; background: rgba(10,10,12,0.92);
      }
      .mini-left, .mini-right { display: flex; align-items: center; gap: 12px; }
      .mini-btn {
        appearance: none; border: none; background: rgba(255,255,255,0.1); color: white; width: 32px; height: 32px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.12s ease, background 0.12s ease;
      }
      .mini-btn:hover { background: rgba(255,255,255,0.18); }
      .mini-btn:active { transform: scale(0.94); }
      .mini-btn svg { width: 16px; height: 16px; }
      .mini-btn.primary { width: 42px; height: 42px; background: #f7f7fb; color: #0c0d0f; }
      .mini-btn.primary:hover { background: #ffffff; }
      .mini-volume {
        width: 100px; accent-color: #efefef; transform: translateY(1px);
      }
      .mini-progress {
        position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,0.18);
      }
      .mini-progress-fill {
        height: 100%; width: ${Math.max(0, Math.min(100, progress))}%; background: linear-gradient(90deg, #c8ced9, #ffffff);
      }
    </style>
    <div class="mini-shell" id="miniShell">
      <aside class="mini-panel" id="miniPanel">
        <div class="mini-panel-header">
          <div class="mini-panel-tabs">
            <button class="mini-tab-btn" id="miniTabPlaylists" type="button">Playlists</button>
            <button class="mini-tab-btn" id="miniTabArtists" type="button">Artists</button>
          </div>
          <button class="mini-panel-toggle" id="miniPanelToggle" type="button" aria-label="Toggle playlist panel">‹</button>
        </div>
        <div class="mini-panel-breadcrumb" id="miniBreadcrumb" style="display:none;"></div>
        <div class="mini-playlist-list" id="miniPlaylistList"></div>
      </aside>
      <div class="mini-card">
        <div class="mini-art-wrap">
          ${art ? `<img class="mini-art" src="${art}" alt="${title}">` : `<div class="mini-art" style="background:linear-gradient(135deg,#20232a,#0c0d0f); display:flex; align-items:center; justify-content:center; font-size:52px; font-weight:700; color:rgba(255,255,255,0.82);">♪</div>`}
          <div class="mini-overlay">
            <h1 class="mini-title">${title}</h1>
            <div class="mini-sub"><span>${sub}</span><span class="dot"></span><span>${state.isPlaying ? 'Playing' : 'Paused'}</span></div>
            <div class="mini-meta" id="miniMeta" style="${metaText ? '' : 'display:none;'}">${metaText}</div>
          </div>
          <div class="mini-progress"><div class="mini-progress-fill"></div></div>
        </div>
        <div class="mini-controls">
          <div class="mini-left">
            <button class="mini-btn" type="button" id="miniPrevBtn" aria-label="Previous track">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12l-10-6z"/></svg>
            </button>
            <button class="mini-btn primary" type="button" id="miniPlayBtn" aria-label="Play or pause">
              <svg id="miniPlayIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <button class="mini-btn" type="button" id="miniNextBtn" aria-label="Next track">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6v12l10-6z"/></svg>
            </button>
          </div>
          <div class="mini-right">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;opacity:0.8"><path d="M11 5 6 9H2v6h4l5 4zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 10 0 0 1 0 7.07"/></svg>
            <input class="mini-volume" id="miniVolume" type="range" min="0" max="1" step="0.01" value="${Math.max(0, Math.min(1, Number(state.volume || 1))) }">
          </div>
        </div>
      </div>
    </div>
  `;

  const playIcon = document.getElementById('miniPlayIcon');
  const miniPanel = document.getElementById('miniPanel');
  const miniList = document.getElementById('miniPlaylistList');
  const miniShell = document.getElementById('miniShell');
  const miniBreadcrumb = document.getElementById('miniBreadcrumb');
  const miniTabPlaylists = document.getElementById('miniTabPlaylists');
  const miniTabArtists = document.getElementById('miniTabArtists');

  function escapeHtmlMini(str){
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 'playlists' | 'artists' | 'albums' | 'songs'
  let miniPanelMode = 'playlists';
  let miniBrowseArtist = null;
  let miniBrowseAlbum = null;

  function miniPanelEmpty(text){
    const empty = document.createElement('div');
    empty.className = 'mini-panel-empty';
    empty.textContent = text;
    miniList.appendChild(empty);
  }

  const syncMiniPanel = () => {
    const opener = window.opener;
    if (!opener || opener.closed) return;
    const api = opener.__sleevePlayerApi;
    if (!api) return;

    miniTabPlaylists.classList.toggle('active', miniPanelMode === 'playlists');
    miniTabArtists.classList.toggle('active', miniPanelMode !== 'playlists');
    miniList.innerHTML = '';
    miniBreadcrumb.innerHTML = '';
    miniBreadcrumb.style.display = 'none';

    if (miniPanelMode === 'playlists'){
      const playlists = api.getPlaylists ? api.getPlaylists() : [];
      const activeId = api.getActivePlaylistId ? api.getActivePlaylistId() : null;
      if (!playlists.length){ miniPanelEmpty('No playlists yet'); return; }
      playlists.forEach(pl => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mini-playlist-btn' + (activeId === pl.id ? ' active' : '');
        btn.innerHTML = `
          <span class="mini-playlist-name">${escapeHtmlMini(pl.name)}</span>
          <span class="mini-playlist-meta">${pl.trackCount} tracks</span>
        `;
        btn.addEventListener('click', () => {
          if (api.activatePlaylist) api.activatePlaylist(pl.id);
        });
        miniList.appendChild(btn);
      });
      return;
    }

    if (miniPanelMode === 'artists'){
      const artists = api.getArtists ? api.getArtists() : [];
      if (!artists.length){ miniPanelEmpty('No artists found yet'); return; }
      artists.forEach(a => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mini-playlist-btn';
        btn.innerHTML = `
          <span class="mini-playlist-name">${escapeHtmlMini(a.name)}</span>
          <span class="mini-playlist-meta">${a.trackCount} tracks</span>
        `;
        btn.addEventListener('click', () => {
          miniBrowseArtist = a.name;
          miniPanelMode = 'albums';
          syncMiniPanel();
        });
        miniList.appendChild(btn);
      });
      return;
    }

    if (miniPanelMode === 'albums'){
      miniBreadcrumb.style.display = 'flex';
      miniBreadcrumb.innerHTML = `<button type="button" id="miniBackToArtists">&lsaquo; Artists</button><span>${escapeHtmlMini(miniBrowseArtist)}</span>`;
      document.getElementById('miniBackToArtists').addEventListener('click', () => {
        miniPanelMode = 'artists';
        syncMiniPanel();
      });
      const albums = api.getAlbumsForArtist ? api.getAlbumsForArtist(miniBrowseArtist) : [];
      if (!albums.length){ miniPanelEmpty('No albums found'); return; }
      albums.forEach(al => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mini-playlist-btn';
        btn.innerHTML = `
          <span class="mini-playlist-name">${escapeHtmlMini(al.name)}</span>
          <span class="mini-playlist-meta">${al.trackCount} tracks</span>
        `;
        btn.addEventListener('click', () => {
          miniBrowseAlbum = al.name;
          miniPanelMode = 'songs';
          syncMiniPanel();
        });
        miniList.appendChild(btn);
      });
      return;
    }

    if (miniPanelMode === 'songs'){
      miniBreadcrumb.style.display = 'flex';
      miniBreadcrumb.innerHTML = `<button type="button" id="miniBackToAlbums">&lsaquo; ${escapeHtmlMini(miniBrowseArtist)}</button><span>${escapeHtmlMini(miniBrowseAlbum)}</span>`;
      document.getElementById('miniBackToAlbums').addEventListener('click', () => {
        miniPanelMode = 'albums';
        syncMiniPanel();
      });
      const tracks = api.getAlbumTracks ? api.getAlbumTracks(miniBrowseArtist, miniBrowseAlbum) : [];
      const current = readMiniState();
      if (!tracks.length){ miniPanelEmpty('No tracks found'); return; }
      tracks.forEach(t => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mini-playlist-btn' + (current.id === t.id ? ' active' : '');
        btn.innerHTML = `<span class="mini-playlist-name">${t.trackNum ? escapeHtmlMini(t.trackNum) + '. ' : ''}${escapeHtmlMini(t.title)}</span>`;
        btn.addEventListener('click', () => {
          if (api.playAlbumTrack) api.playAlbumTrack(miniBrowseArtist, miniBrowseAlbum, t.id, true);
        });
        miniList.appendChild(btn);
      });
    }
  };

  miniTabPlaylists.addEventListener('click', () => {
    miniPanelMode = 'playlists';
    syncMiniPanel();
  });
  miniTabArtists.addEventListener('click', () => {
    miniPanelMode = 'artists';
    miniBrowseArtist = null;
    miniBrowseAlbum = null;
    syncMiniPanel();
  });

  const updateMiniWindow = () => {
    const current = readMiniState();
    const titleText = current.title || 'Nothing playing';
    const { subtitleText, metaText } = subAndMeta(current, 'No track');
    const artUrl = current.thumbUrl || '';
    const progress = current.duration ? Math.min(100, ((current.currentTime || 0) / current.duration) * 100) : 0;
    document.querySelector('.mini-title').textContent = titleText;
    document.querySelector('.mini-sub').innerHTML = `<span>${subtitleText}</span><span class="dot"></span><span>${current.isPlaying ? 'Playing' : 'Paused'}</span>`;
    const metaNode = document.getElementById('miniMeta');
    if (metaNode){
      metaNode.textContent = metaText;
      metaNode.style.display = metaText ? '' : 'none';
    }
    const artNode = document.querySelector('.mini-art');
    if (artUrl) {
      artNode.src = artUrl;
      artNode.style.background = 'transparent';
    } else {
      artNode.src = '';
      artNode.style.background = 'linear-gradient(135deg,#20232a,#0c0d0f)';
      artNode.textContent = '♪';
    }
    document.querySelector('.mini-progress-fill').style.width = `${progress}%`;
    const iconPath = current.isPlaying ? '<path d="M7 5h3v14H7zm7 0h3v14h-3z"/>' : '<path d="M8 5v14l11-7z"/>';
    if (playIcon) playIcon.innerHTML = iconPath;
    const volumeInput = document.getElementById('miniVolume');
    if (volumeInput) volumeInput.value = String(Math.max(0, Math.min(1, Number(current.volume || 1))));
    syncMiniPanel();
  };

  const emit = (action, value) => {
    const opener = window.opener;
    if (opener && !opener.closed) {
      opener.postMessage({ source: 'sleeve-mini-player', action, value }, window.location.origin);
    }
  };

  document.getElementById('miniPlayBtn').addEventListener('click', () => emit('togglePlay'));
  document.getElementById('miniPrevBtn').addEventListener('click', () => emit('prev'));
  document.getElementById('miniNextBtn').addEventListener('click', () => emit('next'));
  document.getElementById('miniVolume').addEventListener('input', (e) => emit('volume', Number(e.target.value)));
  document.getElementById('miniPanelToggle').addEventListener('click', () => {
    const collapsed = miniPanel.classList.toggle('collapsed');
    miniShell.classList.toggle('expanded-panel', !collapsed);
    const toggle = document.getElementById('miniPanelToggle');
    toggle.textContent = collapsed ? '›' : '‹';
  });
  window.addEventListener('storage', updateMiniWindow);
  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'sleeve-main-player') updateMiniWindow();
  });
  updateMiniWindow();
}

const mediaEl = document.getElementById('mediaEl');
mediaEl.volume = 1;

  let playlist = []; // { id, file, url, title, kind, error, loading, wasmBuffer }
  let currentIndex = -1;
  let activeQueueIds = null; // array of track ids defining the current playback order, or null = whole library
  let queueIds = []; // the "context" queue — auto-derived from whatever playlist/album/group you're playing from; replaced whenever you click a track in a different context
  let manualQueueIds = []; // the "Up Next" queue — tracks explicitly added via "Add to queue"; survives context changes until actually played
  let shuffleEnabled = false;
  let repeatMode = 'off'; // off | all | one
  let nextId = 1;
  let currentSpeed = 1;
  let seeking = false;
  let currentEngine = 'media';
  let pendingAutoplayId = null;
// ---------- Demucs stem playback ----------

let stemMode = false;

const stemAudio = {
  drums: new Audio(),
  vocals: new Audio(),
  bass: new Audio(),
  guitar: new Audio(),
  piano: new Audio(),
  other: new Audio()
};

const stemSourceNodes = {
  drums: null,
  vocals: null,
  bass: null,
  guitar: null,
  piano: null,
  other: null
};

// Native <audio>.volume is spec-capped at 1.0, so boosting a stem above
// 100% has to happen via a Web Audio GainNode (gain.value has no upper
// cap) sitting between each stem's source node and the rest of the graph.
const stemGainNodes = {
  drums: null,
  vocals: null,
  bass: null,
  guitar: null,
  piano: null,
  other: null
};

const STEM_VOLUME_MAX = 2.5;

const stemVolumes = {
  drums: 1,
  vocals: 1,
  bass: 1,
  guitar: 1,
  piano: 1,
  other: 1
};

function stemPathToUrl(filePath) {
  if (!filePath) return '';

  // Windows absolute path -> file:/// URL
  if (/^[A-Za-z]:[\\/]/.test(filePath)) {
    return encodeURI(
      'file:///' + filePath.replace(/\\/g, '/')
    ).replace(/#/g, '%23');
  }

  return filePath;
}

function ensureStemAudioGraph() {
  const ctx = getCtx();
  ensureEqFilters(ctx);

  const first = eqFilters[0]?.node || gainNode;

  Object.keys(stemAudio).forEach((name) => {
    if (!stemSourceNodes[name]) {
      try {
        stemSourceNodes[name] =
          ctx.createMediaElementSource(stemAudio[name]);

        stemGainNodes[name] = ctx.createGain();
        stemGainNodes[name].gain.value = stemVolumes[name];

        stemSourceNodes[name].connect(stemGainNodes[name]);
        stemGainNodes[name].connect(first);
      } catch (err) {
        console.warn(
          `[Sleeve] Could not connect ${name} stem:`,
          err
        );
      }
    }
  });
}

function stopStemPlayback() {
  Object.values(stemAudio).forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    } catch (e) {}
  });

  // Note: we deliberately do NOT disconnect/null stemSourceNodes here.
  // A MediaElementAudioSourceNode can only ever be created once per
  // <audio> element for its whole lifetime — disconnecting and nulling
  // it out used to make ensureStemAudioGraph() try to recreate it the
  // next time a stems track loaded, which throws (silently, into a
  // caught warning) and leaves that stem permanently disconnected from
  // any audio output. Leaving the nodes connected (just silent, since
  // the underlying <audio> elements are paused) is what lets a stems
  // track be played again after you've navigated away from it.

  stemMode = false;
  hideStemMixerUI();
}

function showStemMixerUI() {
  const mixer = document.getElementById('stemMixer');
  if (mixer) mixer.style.display = '';
}

function hideStemMixerUI() {
  const mixer = document.getElementById('stemMixer');
  if (mixer) mixer.style.display = 'none';
}

function setStemVolume(name, value) {
  const v = Math.max(0, Math.min(STEM_VOLUME_MAX, Number(value) || 0));

  stemVolumes[name] = v;

  // audio.volume stays at 1 always — actual level (including boosts
  // above 100%) is applied on the stem's GainNode instead, since
  // audio.volume can't go above 1.
  if (stemGainNodes[name]) {
    stemGainNodes[name].gain.value = v;
  }

  const slider = document.querySelector(
    `[data-stem-volume="${name}"]`
  );

  const valueLabel = document.querySelector(
    `[data-stem-value="${name}"]`
  );

  if (slider) slider.value = v;

  if (valueLabel) {
    valueLabel.textContent = `${Math.round(v * 100)}%`;
    valueLabel.style.color = v > 1 ? '#f5a524' : '';
  }
}

function getStemTime() {
  return stemAudio.drums?.currentTime || 0;
}

function getStemDuration() {
  const durations = Object.values(stemAudio)
    .map(audio => audio.duration)
    .filter(Number.isFinite);

  return durations.length ? Math.max(...durations) : 0;
}

function setAllStemTimes(time) {
  Object.values(stemAudio).forEach((audio) => {
    try {
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(
          Math.max(0, time),
          audio.duration
        );
      } else {
        audio.currentTime = Math.max(0, time);
      }
    } catch (e) {}
  });
}

function playAllStems() {
  const playPromises = Object.values(stemAudio).map((audio) => {
    try {
      return audio.play();
    } catch (e) {
      return null;
    }
  });

  Promise.allSettled(playPromises);
  setPlayingUI(true);
}

function pauseAllStems() {
  Object.values(stemAudio).forEach((audio) => {
    try {
      audio.pause();
    } catch (e) {}
  });

  setPlayingUI(false);
}

function createStemMixerUI() {
  if (document.getElementById('stemMixer')) return;

  const mixer = document.createElement('div');

  mixer.id = 'stemMixer';

  mixer.style.cssText = `
    flex-basis: 100%;
    margin-top: 14px;
    padding: 16px;
    border-radius: 12px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    width: min(100%, 520px);
    box-sizing: border-box;
  `;

  mixer.innerHTML = `
    <div style="
      font-size:14px;
      font-weight:600;
      margin-bottom:12px;
      display:flex;
      justify-content:space-between;
      align-items:center;
    ">
      <span>Stem Mixer</span>
      <span style="font-size:11px;opacity:.55;">DEMUCS</span>
    </div>

    <div class="stem-mix-row">
      <span class="stem-mix-name">Drums</span>
      <input
        type="range"
        min="0"
        max="2.5"
        step="0.01"
        value="1"
        data-stem-volume="drums"
      >
      <span class="stem-mix-value" data-stem-value="drums">100%</span>
    </div>

    <div class="stem-mix-row">
      <span class="stem-mix-name">Vocals</span>
      <input
        type="range"
        min="0"
        max="2.5"
        step="0.01"
        value="1"
        data-stem-volume="vocals"
      >
      <span class="stem-mix-value" data-stem-value="vocals">100%</span>
    </div>

    <div class="stem-mix-row">
      <span class="stem-mix-name">Bass</span>
      <input
        type="range"
        min="0"
        max="2.5"
        step="0.01"
        value="1"
        data-stem-volume="bass"
      >
      <span class="stem-mix-value" data-stem-value="bass">100%</span>
    </div>

    <div class="stem-mix-row">
      <span class="stem-mix-name">Guitar</span>
      <input
        type="range"
        min="0"
        max="2.5"
        step="0.01"
        value="1"
        data-stem-volume="guitar"
      >
      <span class="stem-mix-value" data-stem-value="guitar">100%</span>
    </div>

    <div class="stem-mix-row">
      <span class="stem-mix-name">Piano</span>
      <input
        type="range"
        min="0"
        max="2.5"
        step="0.01"
        value="1"
        data-stem-volume="piano"
      >
      <span class="stem-mix-value" data-stem-value="piano">100%</span>
    </div>

    <div class="stem-mix-row">
      <span class="stem-mix-name">Other</span>
      <input
        type="range"
        min="0"
        max="2.5"
        step="0.01"
        value="1"
        data-stem-volume="other"
      >
      <span class="stem-mix-value" data-stem-value="other">100%</span>
    </div>
  `;

  const style = document.createElement('style');

  style.textContent = `
    #stemMixer .stem-mix-row {
      display:grid;
      grid-template-columns:70px 1fr 45px;
      align-items:center;
      gap:10px;
      margin:9px 0;
    }

    #stemMixer .stem-mix-name {
      font-size:12px;
      opacity:.8;
    }

    #stemMixer .stem-mix-value {
      font-size:11px;
      text-align:right;
      opacity:.65;
    }

    #stemMixer input[type="range"] {
      width:100%;
    }
  `;

  document.head.appendChild(style);

  const parent =
    document.getElementById('stagePanel') ||
    document.body;

  parent.appendChild(mixer);

  Object.keys(stemAudio).forEach((name) => {
    const slider = mixer.querySelector(
      `[data-stem-volume="${name}"]`
    );

    slider.addEventListener('input', (event) => {
      setStemVolume(name, Number(event.target.value));
    });
  });
}

async function loadStemTrack(track) {
  if (!track?.stems) return false;

  const stems = track.stems;

  if (
    !stems.drums ||
    !stems.vocals ||
    !stems.bass ||
    !stems.guitar ||
    !stems.piano ||
    !stems.other
  ) {
    return false;
  }

  stopStemPlayback();

  createStemMixerUI();
  showStemMixerUI();

  stemMode = true;
  currentEngine = 'stems';

  ensureStemAudioGraph();

  const names = ['drums', 'vocals', 'bass', 'guitar', 'piano', 'other'];

  names.forEach((name) => {
    const audio = stemAudio[name];

    audio.preload = 'auto';
    audio.src = stemPathToUrl(stems[name]);
    // Real level is applied via the stem's GainNode (see
    // ensureStemAudioGraph/setStemVolume) so it can go above 100%.
    audio.volume = 1;
    audio.playbackRate = currentSpeed;
    audio.load();
    if (stemGainNodes[name]) {
      stemGainNodes[name].gain.value = stemVolumes[name];
    }
  });

  setAllStemTimes(0);

  return true;
}

async function playStems() {
  if (!stemMode) return;

  const currentTime = getStemTime();

  setAllStemTimes(currentTime);

  await Promise.allSettled(
    Object.values(stemAudio).map((audio) => audio.play())
  );

  setPlayingUI(true);
}

function pauseStems() {
  Object.values(stemAudio).forEach((audio) => {
    try {
      audio.pause();
    } catch (e) {}
  });

  setPlayingUI(false);
}

function seekStems(time) {
  setAllStemTimes(Number(time) || 0);
}

Object.keys(stemAudio).forEach((name) => {
  stemAudio[name].addEventListener('timeupdate', () => {
    if (!stemMode || name !== 'drums') return;

    updateTimeDisplay(
      stemAudio[name].currentTime,
      getStemDuration()
    );

    if (!seeking) {
      seekBar.value = stemAudio[name].currentTime;
      setRangeProgress(seekBar);
    }
  });

  stemAudio[name].addEventListener('loadedmetadata', () => {
    if (!stemMode || name !== 'drums') return;

    updateTimeDisplay(
      stemAudio[name].currentTime,
      getStemDuration()
    );
  });
});

stemAudio.drums.addEventListener('ended', () => {
  if (!stemMode) return;

  Object.values(stemAudio).forEach((audio) => {
    try {
      audio.pause();
    } catch (e) {}
  });

  if (settings.autoplayNext) {
    playNext();
  } else {
    setPlayingUI(false);
  }
});
  let playlists = []; // { id, name, type:'music'|'video', trackIds: [] }
  let nextPlaylistId = 1;
  // { type:'home' } | { type:'playlist', id } | { type:'artists' } |
  // { type:'artistAlbums', artist } | { type:'album', artist, album }
  let currentView = { type: 'home' };

  // Pagination state
  let currentPage = 1;
  const ITEMS_PER_PAGE = 60;
  let totalPages = 1;
  let paginationInitialized = false;
  let paginationViewKey = '';

  // Store references for delayed initialization
  let paginationControls = null;
  // Setup pagination after everything else is initialized
  function initPagination(){
    if (paginationInitialized) return;
    paginationInitialized = true;
    
    paginationControls = document.getElementById('paginationControls');
    
    window.updatePaginationControls = function(totalItems){
      if (!paginationControls) return;
      if (totalItems === 0) {
        paginationControls.style.display = 'none';
        paginationControls.innerHTML = '';
        currentPage = 1;
        totalPages = 1;
        return;
      }
      totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
      currentPage = Math.min(currentPage, totalPages);
      if (totalPages <= 1) {
        paginationControls.style.display = 'none';
        paginationControls.innerHTML = '';
        currentPage = 1;
        return;
      }
      paginationControls.style.display = 'flex';
      paginationControls.innerHTML = '';

      const prevBtn = document.createElement('button');
      prevBtn.className = 'pagination-btn';
      prevBtn.textContent = '← Previous';
      prevBtn.disabled = currentPage === 1;
      prevBtn.addEventListener('click', () => window.goToPage(currentPage - 1));
      paginationControls.appendChild(prevBtn);

      const pageNumbers = document.createElement('div');
      pageNumbers.className = 'pagination-pages';
      const maxVisiblePages = 5;
      let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
      let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }

      for (let page = startPage; page <= endPage; page++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = 'pagination-btn pagination-page-btn';
        if (page === currentPage) {
          pageBtn.classList.add('active');
          pageBtn.setAttribute('aria-current', 'page');
        }
        pageBtn.textContent = String(page);
        pageBtn.addEventListener('click', () => window.goToPage(page));
        pageNumbers.appendChild(pageBtn);
      }
      paginationControls.appendChild(pageNumbers);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'pagination-btn';
      nextBtn.textContent = 'Next →';
      nextBtn.disabled = currentPage === totalPages;
      nextBtn.addEventListener('click', () => window.goToPage(currentPage + 1));
      paginationControls.appendChild(nextBtn);

      const info = document.createElement('div');
      info.className = 'pagination-info';
      info.textContent = `Page ${currentPage} of ${totalPages}`;
      paginationControls.appendChild(info);
    };
    
    window.goToPage = function(pageNum){
      if (pageNum < 1 || pageNum > totalPages) return;
      currentPage = pageNum;
      const main = document.querySelector('.main');
      if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
      scheduleRender(searchInput.value);
    };
  }

  // Slices an array down to just the current page's worth of items,
  // updating totalPages/currentPage bookkeeping as it goes. This runs
  // BEFORE any cards are built, so a huge library only ever produces
  // ITEMS_PER_PAGE real DOM nodes per render — not the whole thing
  // hidden behind display:none, which did nothing for actual lag.
  function pageItems(arr){
    if (!arr || !arr.length){
      totalPages = 1;
      currentPage = 1;
      return arr || [];
    }
    totalPages = Math.max(1, Math.ceil(arr.length / ITEMS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return arr.slice(start, start + ITEMS_PER_PAGE);
  }
  
  // The player script is loaded after the pagination container exists.
  initPagination();

  const albumThumbs = new Map(); // albumKey(artist,album) -> { blob, url }
  function albumKey(artist, album){ return artist + '\u241F' + album; }
  const artistThumbs = new Map(); // artistName -> { blob, url }

  window.__sleevePlayerApi = {
    getPlaylists: () => playlists.map(pl => ({ id: pl.id, name: pl.name, trackCount: pl.trackIds.length })),
    getActivePlaylistId: () => (currentView.type === 'playlist' ? currentView.id : null),
    activatePlaylist: (playlistId, autoplay = true) => {
      const pl = playlists.find(p => p.id === playlistId);
      if (!pl) return false;
      currentView = { type: 'playlist', id: pl.id };
      // A playlist has its own explicit order. Reset the playback queue to that
      // order whenever the playlist is opened so an old global queue cannot
      // make tracks play in library/import order.
      queueIds = pl.trackIds.slice();
      activeQueueIds = queueIds.slice();
      if (shuffleEnabled) shuffleArray(queueIds);
      scheduleRender(searchInput.value);
      if (pl.trackIds.length > 0) {
        const firstTrackIndex = playlist.findIndex(t => t.id === pl.trackIds[0]);
        if (firstTrackIndex !== -1) playTrackAt(firstTrackIndex, autoplay);
      }
      return true;
    },
    getArtists: () => getArtists().map(a => ({ name: a.name, trackCount: a.tracks.length })),
    getAlbumsForArtist: (artistName) => getAlbumsForArtist(artistName).map(al => ({ name: al.name, trackCount: al.tracks.length })),
    getAlbumTracks: (artistName, albumName) => {
      const tracks = playlist.filter(t => t.kind !== 'video'
        && (t.artist || 'Unknown Artist') === artistName
        && (t.album || 'Unknown Album') === albumName);
      const sorted = tracks.sort((a, b) => settings.albumTrackOrder
        ? (a.trackNum || Number.MAX_SAFE_INTEGER) - (b.trackNum || Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)
        : playlist.indexOf(a) - playlist.indexOf(b));
      return sorted.map(t => ({ id: t.id, title: t.title, trackNum: t.trackNum || null }));
    },
    playAlbumTrack: (artistName, albumName, trackId, autoplay = true) => {
      currentView = { type: 'album', artist: artistName, album: albumName };
      scheduleRender(searchInput.value);
      const idx = playlist.findIndex(t => t.id === trackId);
      if (idx === -1) return false;
      playTrackAt(idx, autoplay);
      return true;
    }
  };

  // ---------- Persistence (IndexedDB) ----------
  const DB_NAME = 'sleeveDB';
  const STORE = 'tracks';
  let dbPromise = null;

  const PLAYLIST_STORE = 'playlists';
  const ALBUM_ART_STORE = 'albumArt';
  const ARTIST_ART_STORE = 'artistArt';

  function openDB(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB){ reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(DB_NAME, 4);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(PLAYLIST_STORE)) db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(ALBUM_ART_STORE)) db.createObjectStore(ALBUM_ART_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(ARTIST_ART_STORE)) db.createObjectStore(ARTIST_ART_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => { console.warn('Sleeve: storage unavailable', err); return null; });
    return dbPromise;
  }

  const pendingTrackWrites = new Map();
  let trackWriteTimer = null;
  let trackWriteFlushPromise = null;

  function queueTrackWrite(track){
    pendingTrackWrites.set(track.id, { id: track.id, title: track.title, kind: track.kind, file: track.file, thumb: track.thumb || null, thumbKind: track.thumbKind || null, lyrics: track.lyrics || null, artist: track.artist || null, album: track.album || null, year: track.year || null, genre: track.genre || null, trackNum: track.trackNum || null, duration: track.duration || null, manualMetadata: track.manualMetadata || {}, playCount: track.playCount || 0, lastPlayedAt: track.lastPlayedAt || null, addedAt: track.addedAt || Date.now(), sourcePath: track.sourcePath || track.file?.webkitRelativePath || track.file?.path || track.file?.name || '', stems: track.stems || null, musicBrainzReleaseId: track.musicBrainzReleaseId || null,
 });
    if (!trackWriteTimer) trackWriteTimer = setTimeout(flushTrackWrites, 100);
  }

  async function flushTrackWrites(){
    trackWriteTimer = null;
    if (trackWriteFlushPromise || pendingTrackWrites.size === 0) return trackWriteFlushPromise;
    trackWriteFlushPromise = (async () => {
      const db = await openDB();
      if (!db) return;
      const batch = Array.from(pendingTrackWrites.values());
      pendingTrackWrites.clear();
      try{
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        batch.forEach(rec => store.put(rec));
      }catch(err){ console.warn('Sleeve: could not save track batch', err); }
      finally{
        trackWriteFlushPromise = null;
        if (pendingTrackWrites.size && !trackWriteTimer) trackWriteTimer = setTimeout(flushTrackWrites, 100);
      }
    })();
    return trackWriteFlushPromise;
  }

  async function dbPut(track){ queueTrackWrite(track); }

  async function dbGetAll(){
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      try{
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }catch(err){ resolve([]); }
    });
  }

  async function dbClear(){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
    }catch(err){ console.warn('Sleeve: could not clear storage', err); }
  }

  async function dbClearAlbumThumbs(){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(ALBUM_ART_STORE, 'readwrite');
      tx.objectStore(ALBUM_ART_STORE).clear();
    }catch(err){ console.warn('Sleeve: could not clear album thumbnails', err); }
  }

  async function dbClearArtistThumbs(){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(ARTIST_ART_STORE, 'readwrite');
      tx.objectStore(ARTIST_ART_STORE).clear();
    }catch(err){ console.warn('Sleeve: could not clear artist thumbnails', err); }
  }

  async function dbDeleteTrack(id){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
    }catch(err){ console.warn('Sleeve: could not delete track', err); }
  }

  async function dbPutPlaylist(pl){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(PLAYLIST_STORE, 'readwrite');
      tx.objectStore(PLAYLIST_STORE).put({ id: pl.id, name: pl.name, type: pl.type || 'music', trackIds: pl.trackIds, thumb: pl.thumb || null });
    }catch(err){ console.warn('Sleeve: could not save playlist', err); }
  }

  async function dbGetAllPlaylists(){
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      try{
        const tx = db.transaction(PLAYLIST_STORE, 'readonly');
        const req = tx.objectStore(PLAYLIST_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }catch(err){ resolve([]); }
    });
  }

  async function dbDeletePlaylist(id){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(PLAYLIST_STORE, 'readwrite');
      tx.objectStore(PLAYLIST_STORE).delete(id);
    }catch(err){ console.warn('Sleeve: could not delete playlist', err); }
  }

  async function dbPutAlbumThumb(key, blob, kind){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(ALBUM_ART_STORE, 'readwrite');
      tx.objectStore(ALBUM_ART_STORE).put({ key, thumb: blob, kind: kind || 'image' });
    }catch(err){ console.warn('Sleeve: could not save album thumbnail', err); }
  }
  let stemUnsubscribe = null

  // File types Demucs/our embedded Python can split directly. Anything
  // else (FLAC, OGG, M4A, video containers, etc.) gets offered a
  // convert-to-MP3 step first. Adjust this list if more formats turn out
  // to work fine as-is.
  const DIRECTLY_SPLITTABLE_EXTENSIONS = new Set(['mp3', 'wav'])

  function getFileExtension(filePath) {
    if (!filePath) return ''
    const clean = String(filePath).split(/[?#]/)[0]
    const dot = clean.lastIndexOf('.')
    return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase()
  }

  function isDirectlySplittable(filePath) {
    return DIRECTLY_SPLITTABLE_EXTENSIONS.has(getFileExtension(filePath))
  }

function openStemOverlay(track) {
  document.getElementById('stemOverlay').classList.add('open')
  document.getElementById('stemProgress').hidden = true
  document.getElementById('stemConfirm').hidden = false
  document.getElementById('stemConfirm').onclick = () => runStemSplit(track)
  document.getElementById('stemCancel').onclick = closeStemOverlay
}

function closeStemOverlay() {
  document.getElementById('stemOverlay').classList.remove('open')
  if (stemUnsubscribe) { stemUnsubscribe(); stemUnsubscribe = null }
}

function openConvertOverlay(track) {
  document.getElementById('convertOverlay').classList.add('open')
  document.getElementById('convertOverlayMessage').textContent =
    'This file cannot be split into stems because of its file type. Do you want to convert this file to MP3?'
  document.getElementById('convertProgress').hidden = true
  document.getElementById('convertConfirm').hidden = false
  document.getElementById('convertConfirm').onclick = () => runConvertAndSplit(track)
  document.getElementById('convertCancel').onclick = closeConvertOverlay
}

function closeConvertOverlay() {
  document.getElementById('convertOverlay').classList.remove('open')
}

async function runConvertAndSplit(track) {
  // Stop whatever's currently playing (media/wasm/stems) first. Without
  // this, converting+splitting a FLAC that's already playing leaves the
  // original wasm playback running underneath the new stems, and since
  // currentEngine switches to 'stems' right after, the play/pause button
  // can no longer reach that orphaned original playback at all.
  stopEverything();

  document.getElementById('convertConfirm').hidden = true
  document.getElementById('convertProgress').hidden = false
  document.getElementById('convertProgressLabel').textContent = 'Converting…'

  let mp3Path
  try {
    mp3Path = await window.electronAPI.convertToMp3(track.sourcePath)
  } catch (err) {
    document.getElementById('convertProgressLabel').textContent = `Conversion failed: ${err.message}`
    return
  }

  closeConvertOverlay()

  // Go straight into the split — no second confirmation click needed —
  // reusing the same stem-overlay panel to show splitting progress.
  document.getElementById('stemOverlay').classList.add('open')
  document.getElementById('stemConfirm').hidden = true
  document.getElementById('stemProgress').hidden = false
  document.getElementById('stemCancel').onclick = closeStemOverlay

    try {
    const existingStems =
      await window.electronAPI.findExistingStems(mp3Path)

    if (existingStems) {
      track.stems = existingStems
      dbPut(track)

      closeStemOverlay()

      createStemMixerUI()
      await loadStemTrack(track)

      const mixer = document.getElementById('stemMixer')
      if (mixer) {
        mixer.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        })
      }

      await playStems()
      return
    }
  } catch (err) {
    console.warn('[STEMS] Could not check cached stems:', err)
  }

  runStemSplit(track, mp3Path)
}

async function runStemSplit(track, sourcePathOverride) {
  // Stop whatever's currently playing (media/wasm/stems) so the original
  // recording can't keep running out of sync with the split while demucs
  // works — the track restarts fresh in stem mode once splitting is done.
  stopEverything()

  document.getElementById('stemConfirm').hidden = true
  document.getElementById('stemProgress').hidden = false

  stemUnsubscribe = window.electronAPI.onStemsProgress((payload) => {
    const label = document.getElementById('stemProgressLabel')
    const bar = document.getElementById('stemProgressBar')
    if (payload.status === 'starting') label.textContent = 'Starting…'
    if (payload.status === 'processing') {
      label.textContent = `Splitting… ${payload.percent}%`
      bar.style.width = `${payload.percent}%`
    }
    if (payload.status === 'done') label.textContent = 'Finishing up…'
  })

  try {
  const filePath = window.electronAPI.getPathForFile(track?.file) || sourcePathOverride || track.sourcePath;

console.log('[STEMS DEBUG] REAL PATH:', filePath);

const stems = await window.electronAPI.splitStems(filePath);
track.stems = stems
dbPut(track)

closeStemOverlay()

createStemMixerUI()

await loadStemTrack(track)

const mixer = document.getElementById('stemMixer')
if (mixer) {
  mixer.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  })
}

await playStems()
  } catch (err) {
    document.getElementById('stemProgressLabel').textContent = `Something went wrong: ${err.message}`
  }
}

document.getElementById('stemTrigger').addEventListener('click', () => {
  const track = currentIndex >= 0 ? playlist[currentIndex] : null;

  console.log('[STEMS DEBUG] track:', track);
console.log('[STEMS DEBUG] sourcePath:', track?.sourcePath);
console.log('[STEMS DEBUG] file:', track?.file);
console.log('[STEMS DEBUG] file.name:', track?.file?.name);
console.log('[STEMS DEBUG] file.path:', track?.file?.path);
console.log('[STEMS DEBUG] file.webkitRelativePath:', track?.file?.webkitRelativePath);


  if (!track) return;

  if (!isDirectlySplittable(track.sourcePath)) {
    openConvertOverlay(track);
    return;
  }

  openStemOverlay(track);
});

  async function dbGetAllAlbumThumbs(){
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      try{
        const tx = db.transaction(ALBUM_ART_STORE, 'readonly');
        const req = tx.objectStore(ALBUM_ART_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }catch(err){ resolve([]); }
    });
  }

  async function dbDeleteAlbumThumb(key){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(ALBUM_ART_STORE, 'readwrite');
      tx.objectStore(ALBUM_ART_STORE).delete(key);
    }catch(err){ console.warn('Sleeve: could not delete album thumbnail', err); }
  }

  async function dbPutArtistThumb(key, blob){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(ARTIST_ART_STORE, 'readwrite');
      tx.objectStore(ARTIST_ART_STORE).put({ key, thumb: blob });
    }catch(err){ console.warn('Sleeve: could not save artist thumbnail', err); }
  }

  async function dbGetAllArtistThumbs(){
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      try{
        const tx = db.transaction(ARTIST_ART_STORE, 'readonly');
        const req = tx.objectStore(ARTIST_ART_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }catch(err){ resolve([]); }
    });
  }

  async function dbDeleteArtistThumb(key){
    const db = await openDB();
    if (!db) return;
    try{
      const tx = db.transaction(ARTIST_ART_STORE, 'readwrite');
      tx.objectStore(ARTIST_ART_STORE).delete(key);
    }catch(err){ console.warn('Sleeve: could not delete artist thumbnail', err); }
  }

  // ---------- WASM (FLAC) engine state ----------
  let audioCtx = null, gainNode = null;
  let wasmBuffer = null, wasmSource = null;
  let wasmStartCtxTime = 0, wasmOffset = 0, wasmPlaying = false, wasmRAF = null;

  function getCtx(){
    if (!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            /*
       * Apply the saved Sleeve-only output as soon as the shared
       * AudioContext exists. setSinkId is asynchronous, so playback
       * itself does not wait for this operation.
       */
      if (
        settings &&
        settings.audioOutputId &&
        typeof audioCtx.setSinkId === 'function'
      ){
        audioCtx.setSinkId(settings.audioOutputId).catch(err => {
          console.warn(
            '[Sleeve] Could not restore saved audio output:',
            err
          );
        });
      }
      gainNode = audioCtx.createGain();
      eqLimiterNode = audioCtx.createDynamicsCompressor();
      eqLimiterNode.threshold.value = -18;
      eqLimiterNode.knee.value = 10;
      eqLimiterNode.ratio.value = 4;
      eqLimiterNode.attack.value = 0.01;
      eqLimiterNode.release.value = 0.22;
      gainNode.connect(eqLimiterNode);
      eqLimiterNode.connect(audioCtx.destination);
      ensureEqFilters(audioCtx);
      rebuildEqGain();
    }
    return audioCtx;
  }

  let flacDecoderPromise = null;
  function getFlacDecoder(){
    if (!flacDecoderPromise){
      flacDecoderPromise = new Promise((resolve) => {
        const check = () => {
          if (window['flac-decoder'] && window['flac-decoder'].FLACDecoder){
            const d = new window['flac-decoder'].FLACDecoder();
            d.ready.then(() => resolve(d));
          } else {
            setTimeout(check, 60);
          }
        };
        check();
      });
    }
    return flacDecoderPromise;
  }

  async function decodeFlacTrack(track){
    const decoder = await getFlacDecoder();
    const arrayBuffer = await track.file.arrayBuffer();
    const { channelData, samplesDecoded, sampleRate } = await decoder.decodeFile(new Uint8Array(arrayBuffer));
    await decoder.reset();
    if (!samplesDecoded) throw new Error('No audio decoded');
    const ctx = getCtx();
    const buffer = ctx.createBuffer(channelData.length, samplesDecoded, sampleRate);
    channelData.forEach((chan, i) => buffer.getChannelData(i).set(chan));
    return buffer;
  }

  function getWasmCurrentTime(){
    if (!wasmBuffer) return 0;
    if (!wasmPlaying) return wasmOffset;
    const ctx = getCtx();
    return wasmOffset + (ctx.currentTime - wasmStartCtxTime) * currentSpeed;
  }

  function wasmPlay(offsetSeconds){
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    if (wasmSource){ try{ wasmSource.onended = null; wasmSource.stop(); }catch(e){} }
    const source = ctx.createBufferSource();
    source.buffer = wasmBuffer;
    source.playbackRate.value = currentSpeed;
    wireFlacSource(source);
    wasmOffset = offsetSeconds;
    wasmStartCtxTime = ctx.currentTime;
    source.start(0, offsetSeconds);
    source.onended = () => {
      if (wasmPlaying && getWasmCurrentTime() >= wasmBuffer.duration - 0.08){
        wasmPlaying = false;
        setPlayingUI(false);
        stopWasmClock();
        if (settings.autoplayNext) playNext();
      }
    };
    wasmSource = source;
    wasmPlaying = true;
    setPlayingUI(true);
    startWasmClock();
  }

  function wasmPause(){
    if (!wasmPlaying) return;
    wasmOffset = getWasmCurrentTime();
    wasmPlaying = false;
    if (wasmSource){ wasmSource.onended = null; try{ wasmSource.stop(); }catch(e){} wasmSource = null; }
    setPlayingUI(false);
    stopWasmClock();
  }

  function wasmSeek(t){
    t = Math.max(0, Math.min(t, wasmBuffer.duration || 0));
    if (wasmPlaying){ wasmPlay(t); } else { wasmOffset = t; updateTimeDisplay(t, wasmBuffer.duration); }
  }

  function startWasmClock(){
    stopWasmClock();
    const tick = () => {
      if (!wasmPlaying) return;
      const cur = getWasmCurrentTime();
      updateTimeDisplay(cur, wasmBuffer.duration);
      wasmRAF = requestAnimationFrame(tick);
    };
    wasmRAF = requestAnimationFrame(tick);
  }
  function stopWasmClock(){ if (wasmRAF) cancelAnimationFrame(wasmRAF); wasmRAF = null; }

  // ---------- Shared UI ----------
  const fileInput = document.getElementById('fileInput');
  const folderInput = document.getElementById('folderInput');
  const addBtn = document.getElementById('addBtn');
  const addBtnEmpty = document.getElementById('addBtnEmpty');
  const addFolderBtn = document.getElementById('addFolderBtn');
  const addFolderBtnEmpty = document.getElementById('addFolderBtnEmpty');
  const trackListSidebar = document.getElementById('trackListSidebar');
  const emptyShelfSidebar = document.getElementById('emptyShelfSidebar');
  const cardGrid = document.getElementById('cardGrid');
  const emptyMain = document.getElementById('emptyMain');
  const albumDetail = document.getElementById('albumDetail');
  const subhead = document.getElementById('subhead');
  const searchInput = document.getElementById('searchInput');
  const clearLibraryBtn = document.getElementById('clearLibraryBtn');
  const clearThumbsBtn = document.getElementById('clearThumbsBtn');
  const navHome = document.getElementById('navHome');
  const navArtists = document.getElementById('navArtists');
  const navBrowse = document.getElementById('navBrowse');
  const browseSwitch = document.getElementById('browseSwitch');
  const browseSwitchYear = document.getElementById('browseSwitchYear');
  const browseSwitchGenre = document.getElementById('browseSwitchGenre');
  const viewBackBtn = document.getElementById('viewBackBtn');
  const viewBackBtnLabel = document.getElementById('viewBackBtnLabel');
  const musicPlaylistList = document.getElementById('musicPlaylistList');
  const videoPlaylistList = document.getElementById('videoPlaylistList');
  const newMusicPlaylistBtn = document.getElementById('newMusicPlaylistBtn');
  const newVideoPlaylistBtn = document.getElementById('newVideoPlaylistBtn');
  const videoSizeButtons = document.querySelectorAll('[data-video-size]');
  const videoPipBtn = document.getElementById('videoPipBtn');

  function setVideoMode(mode){
    const allowed = ['compact', 'standard', 'large', 'wide'];
    const selected = allowed.includes(mode) ? mode : 'standard';
    stagePanel.classList.remove(...allowed.map(value => `video-${value}`));
    stagePanel.classList.add(`video-${selected}`);
    videoSizeButtons.forEach(button => button.classList.toggle('active', button.dataset.videoSize === selected));
    if (settings) settings.videoSize = selected;
  }
  videoSizeButtons.forEach(button => button.addEventListener('click', () => {
    setVideoMode(button.dataset.videoSize);
    saveSettings();
  }));
  videoPipBtn.addEventListener('click', async () => {
    if (!mediaEl || mediaEl.videoWidth === 0 || !document.pictureInPictureEnabled) return;
    try{
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await mediaEl.requestPictureInPicture();
    }catch(e){}
  });
  const greeting = document.getElementById('greeting');

  const stageVisual = document.getElementById('stageVisual');
  const stagePanel = document.getElementById('stagePanel');
  const stageCloseBtn = document.getElementById('stageCloseBtn');
  const stageDisc = document.getElementById('stageDisc');
  if (stageCloseBtn){
    stageCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stagePanel.classList.add('stage-closed');
    });
  }
  const stageTitle = document.getElementById('stageTitle');
  const stageSub = document.getElementById('stageSub');
  const stageBadge = document.getElementById('stageBadge');
  const stageThumb = document.getElementById('stageThumb');
  const stageThumbVideo = document.getElementById('stageThumbVideo');

  const npTitle = document.getElementById('npTitle');
  const npSub = document.getElementById('npSub');
  const npArt = document.getElementById('npArt');
  const npThumb = document.getElementById('npThumb');
  const npThumbVideo = document.getElementById('npThumbVideo');
  const playBtn = document.getElementById('playBtn');
  const playIcon = document.getElementById('playIcon');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const seekBar = document.getElementById('seekBar');
  const curTimeEl = document.getElementById('curTime');
  const durTimeEl = document.getElementById('durTime');
  const volBar = document.getElementById('volBar');
  const disc = document.getElementById('disc');

  const speedSelect = document.getElementById('speedSelect');
  const miniPlayerBtn = document.getElementById('miniPlayerBtn');
  let miniPlayerWindow = null;

  function getMiniPlayerWindowDimensions(){
    const scale = Math.max(15, Math.min(140, Number(settings.miniPlayerScale) || 100));
    return {
      width: Math.round(420 * scale / 100),
      height: Math.round(760 * scale / 100)
    };
  }

  function openMiniPlayerWindow(){
    if (miniPlayerWindow && !miniPlayerWindow.closed) {
      const { width, height } = getMiniPlayerWindowDimensions();
      try {
        miniPlayerWindow.resizeTo(width, height);
      } catch (e) {}
      miniPlayerWindow.focus();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('mini', '1');
    const { width, height } = getMiniPlayerWindowDimensions();
    const features = `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no,alwaysRaised=yes,dependent=no`;
    miniPlayerWindow = window.open(url.toString(), 'SleeveMiniPlayer', features);
    if (miniPlayerWindow) {
      try {
        miniPlayerWindow.focus();
        miniPlayerWindow.moveTo(0, 0);
      } catch (e) {}
      const keepOnTop = () => {
        if (!miniPlayerWindow || miniPlayerWindow.closed) return;
        try {
          miniPlayerWindow.focus();
          miniPlayerWindow.moveTo(miniPlayerWindow.screenX, miniPlayerWindow.screenY);
        } catch (e) {}
      };
      clearInterval(window.__sleeveMiniTopper);
      window.__sleeveMiniTopper = setInterval(keepOnTop, 1200);
    }
  }
  miniPlayerBtn.addEventListener('click', openMiniPlayerWindow);

  // ---------- Customization settings ----------
  const SETTINGS_KEY = 'sleeveSettings';
  const DEFAULT_SETTINGS = {
    audioOutputId: 'default',
    audioOutputLabel: 'System Default',
    accent: 'cyan',
    accentCustom: null,
    theme: 'navy',
    radius: 10,
    cardStyle: 'normal',
    compactCards: false,
    noCardLift: false,
    atmosphere: false,
    highContrast: false,
    pattern: false,
    nowPlayingThumb: false,
    thumbnailFit: 'cover',
    font: 'serif',
    view: 'grid',
    cardSize: 160,
    cardGap: 18,
    sidebarWidth: 260,
    miniPlayerScale: 100,
    showStage: true,
    autoplayNext: true,
    reduceMotion: false,
    videoSize: 'standard',
    detailedAlbumView: false,
    albumTrackOrder: true,
    albumArtAsTrackThumb: false,
    thumbRadius: 10,
    previewRadius: 10,
    uiScale: 100,
    cardShadow: true,
    boldTitles: false,
    hairlines: true,
    activeGlow: false,
    sidebarBlur: false,
    rowDensity: 'comfortable',
    playlistThumbSize: 24,
    libraryThumbSize: 34,
    topPageNavigation: false,
    appPreset: 'sleeve',
    smartCollapsed: {},
    smartRecentlyAdded: true,
    smartRecentlyPlayed: true,
    smartMostPlayed: false,
    smartNeverPlayed: false,
  };

  const ACCENTS = {
    cyan:   { blue: '#1c6fa8', bright: '#17abe8', ice: '#8fd8f7' },
    violet: { blue: '#5b4a95', bright: '#8b6bd8', ice: '#c9b8f2' },
    rose:   { blue: '#9c4062', bright: '#e0658f', ice: '#f5b8cd' },
    green:  { blue: '#1f7a4d', bright: '#3fae72', ice: '#9fe3bd' },
    amber:  { blue: '#a87418', bright: '#d9a441', ice: '#f0d29a' },
    red:    { blue: '#9c3a30', bright: '#d3564a', ice: '#f0a89f' },
    teal:   { blue: '#167d78', bright: '#22b8a7', ice: '#9ae6dd' },
    gold:   { blue: '#9a711c', bright: '#e0b341', ice: '#f4d98b' },
    coral:  { blue: '#a64e43', bright: '#f07862', ice: '#ffc0b2' },
  };

  const THEMES = {
    navy:     { bg: '#0a1526', bgSidebar: '#071019', bgElevated: '#16233a', bgElevated2: '#1e2d47', bgCard: '#121e33', bgCardHover: '#1a2942' },
    charcoal: { bg: '#101012', bgSidebar: '#0a0a0b', bgElevated: '#1c1c1f', bgElevated2: '#26262a', bgCard: '#18181b', bgCardHover: '#222226' },
    plum:     { bg: '#160f22', bgSidebar: '#0f0a18', bgElevated: '#241735', bgElevated2: '#301f45', bgCard: '#1e1430', bgCardHover: '#2a1c3f' },
    forest:   { bg: '#0d1712', bgSidebar: '#08110d', bgElevated: '#16261e', bgElevated2: '#1e3327', bgCard: '#131f19', bgCardHover: '#1c2f24' },
    ocean:    { bg: '#071823', bgSidebar: '#051119', bgElevated: '#0e2b38', bgElevated2: '#154352', bgCard: '#0b222d', bgCardHover: '#123542' },
    sunset:   { bg: '#211416', bgSidebar: '#140b0d', bgElevated: '#3b2020', bgElevated2: '#563027', bgCard: '#2d191b', bgCardHover: '#472426' },
    paper:    { bg: '#d8d8d1', bgSidebar: '#c4c8c5', bgElevated: '#e7e6df', bgElevated2: '#f1f0e9', bgCard: '#eeede5', bgCardHover: '#ffffff', text: '#20252a', textDim: '#566169', textDimmer: '#758087' },
    midnight: { bg: '#07090e', bgSidebar: '#04050a', bgElevated: '#101521', bgElevated2: '#1a2332', bgCard: '#0c111b', bgCardHover: '#151e2c' },
  };

  // App style presets. These are subtle nods to other players' look and
  // feel — built entirely out of settings Sleeve already supports, not a
  // pixel clone — so someone unfamiliar with Sleeve's native look has a
  // more comfortable starting point. Every field below can still be
  // overridden individually afterward; picking a preset just changes the
  // defaults it fills in.
  const APP_PRESETS = {
    sleeve: {
      accent: 'cyan',
      theme: 'navy',
      font: 'serif',
      cardStyle: 'normal',
      radius: 10,
      cardShadow: true,
      boldTitles: false,
      rowDensity: 'comfortable',
      activeGlow: false,
    },
    spotify: {
  accent: 'green',
  theme: 'charcoal',
  font: 'sans',
  cardStyle: 'flat',
  radius: 8,
  cardShadow: false,
  boldTitles: true,
  rowDensity: 'compact',
  activeGlow: true,
  topPageNavigation: true,
  showStage: true,
},
   amazonMusic: {
  accent: 'cyan',
  theme: 'midnight',
  font: 'sans',
  cardStyle: 'normal',
  radius: 12,
  cardShadow: true,
  boldTitles: false,
  rowDensity: 'comfortable',
  activeGlow: false,
topPageNavigation: true,
},
};


  function hexToHsl(hex){
    hex = hex.replace('#','');
    const r = parseInt(hex.substr(0,2),16)/255, g = parseInt(hex.substr(2,2),16)/255, b = parseInt(hex.substr(4,2),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, s, l = (max+min)/2;
    if (max === min){ h = s = 0; }
    else{
      const d = max-min;
      s = l > 0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h = (g-b)/d + (g<b?6:0); break;
        case g: h = (b-r)/d + 2; break;
        default: h = (r-g)/d + 4;
      }
      h /= 6;
    }
    return [h*360, s*100, l*100];
  }
  function hslToHex(h,s,l){
    s/=100; l/=100;
    const c = (1-Math.abs(2*l-1))*s, x = c*(1-Math.abs((h/60)%2-1)), m = l-c/2;
    let r=0,g=0,b=0;
    if (h<60){r=c;g=x;} else if (h<120){r=x;g=c;} else if (h<180){g=c;b=x;}
    else if (h<240){g=x;b=c;} else if (h<300){r=x;b=c;} else {r=c;b=x;}
    const toHex = v => Math.round((v+m)*255).toString(16).padStart(2,'0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  function deriveAccentFromCustom(hex){
    const [h,s,l] = hexToHsl(hex);
    return {
      blue: hslToHex(h, Math.max(20,s*0.75), Math.max(20, l*0.62)),
      bright: hex,
      ice: hslToHex(h, Math.max(15,s*0.5), Math.min(88, l+30)),
    };
  }

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  // ---------- Audio output routing ----------
  //
  // Sleeve controls its own audio destination without changing the
  // Windows system default output device.
  //
  // All normal media, FLAC/WebAudio playback, EQ, and Demucs stems
  // ultimately pass through the shared AudioContext, so changing the
  // AudioContext sink routes Sleeve's audio as one unit.

  let audioOutputDevices = [];
  let audioOutputRefreshTimer = null;

  function supportsAudioOutputSelection(){
    return !!(
      window.AudioContext &&
      AudioContext.prototype &&
      typeof AudioContext.prototype.setSinkId === 'function'
    );
  }

  async function enumerateAudioOutputs(){
    if (!navigator.mediaDevices ||
        typeof navigator.mediaDevices.enumerateDevices !== 'function'){
      audioOutputDevices = [];
      renderAudioOutputDevices();
      return [];
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      audioOutputDevices = devices.filter(
        device => device.kind === 'audiooutput'
      );

      renderAudioOutputDevices();
      return audioOutputDevices;
    } catch (err) {
      console.warn('[Sleeve] Could not enumerate audio outputs:', err);
      audioOutputDevices = [];
      renderAudioOutputDevices();
      return [];
    }
  }

  function getAudioOutputLabel(device){
    if (device.deviceId === 'default'){
      return 'System Default';
    }

    return device.label || `Speaker / Output ${audioOutputDevices.indexOf(device) + 1}`;
  }

  async function applyAudioOutputDevice(deviceId, options = {}){
    const requestedId = deviceId || 'default';

    if (!audioCtx){
      try {
        getCtx();
      } catch (err) {
        console.warn('[Sleeve] Could not initialize audio context:', err);
        return false;
      }
    }

    if (!audioCtx ||
        typeof audioCtx.setSinkId !== 'function'){
      console.warn('[Sleeve] This Electron/Chromium build does not support AudioContext.setSinkId().');
      return false;
    }

    try {
      await audioCtx.setSinkId(requestedId);

      const device = audioOutputDevices.find(
        d => d.deviceId === requestedId
      );

      settings.audioOutputId = requestedId;
      settings.audioOutputLabel =
        requestedId === 'default'
          ? 'System Default'
          : getAudioOutputLabel(device || {
              deviceId: requestedId,
              label: ''
            });

      if (!options.skipSave){
        saveSettings();
      }

      syncAudioOutputControls();
      return true;
    } catch (err) {
      console.warn(
        `[Sleeve] Could not switch audio output to "${requestedId}":`,
        err
      );

      // If the selected device vanished, automatically return to the
      // Windows/system default rather than leaving Sleeve silent.
      if (requestedId !== 'default'){
        try {
          await audioCtx.setSinkId('default');

          settings.audioOutputId = 'default';
          settings.audioOutputLabel = 'System Default';

          if (!options.skipSave){
            saveSettings();
          }

          syncAudioOutputControls();
          return true;
        } catch (fallbackErr) {
          console.warn(
            '[Sleeve] Could not fall back to system default output:',
            fallbackErr
          );
        }
      }

      return false;
    }
  }

  function createAudioOutputControls(){
    if (document.getElementById('audioOutputSection')) return;

    const drawerBody = document.querySelector('.drawer-body');
    if (!drawerBody) return;

    const section = document.createElement('section');
    section.id = 'audioOutputSection';
    section.className = 'drawer-section audio-output-section';

    section.innerHTML = `
      <div class="drawer-section-title">Audio Output</div>

      <div class="audio-output-card">
        <div class="audio-output-heading">
          <div>
            <div class="audio-output-label">Output device</div>
            <div class="audio-output-description">
              Choose where Sleeve sends its audio.
            </div>
          </div>
          <span class="audio-output-status" id="audioOutputStatus">Ready</span>
        </div>

        <select
          id="audioOutputSelect"
          class="audio-output-select"
          aria-label="Sleeve audio output device"
        >
          <option value="default">System Default</option>
        </select>

        <div class="audio-output-actions">
          <button
            id="audioOutputRefresh"
            class="audio-output-refresh"
            type="button"
          >
            Refresh devices
          </button>
        </div>

        <div class="audio-output-note">
          This only changes Sleeve's audio output. It does not change
          Windows' default speaker for the rest of your computer.
        </div>
      </div>
    `;

    /*
     * Put audio output near the top of Settings so it is easy to find,
     * rather than burying an important playback setting at the bottom.
     */
    const firstSection = drawerBody.querySelector('.drawer-section');

    if (firstSection){
      drawerBody.insertBefore(section, firstSection);
    } else {
      drawerBody.prepend(section);
    }

    const select = document.getElementById('audioOutputSelect');
    const refresh = document.getElementById('audioOutputRefresh');

    select.addEventListener('change', async () => {
      const deviceId = select.value;

      const status = document.getElementById('audioOutputStatus');
      if (status) status.textContent = 'Switching…';

      const success = await applyAudioOutputDevice(deviceId);

      if (status){
        status.textContent = success ? 'Active' : 'Unavailable';
      }
    });

    refresh.addEventListener('click', async () => {
      await refreshAudioOutputDevices();
    });
  }

  function renderAudioOutputDevices(){
    const select = document.getElementById('audioOutputSelect');
    if (!select) return;

    const currentId = settings.audioOutputId || 'default';

    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'System Default';
    select.appendChild(defaultOption);

    const seenIds = new Set(['default']);

    audioOutputDevices.forEach(device => {
      if (!device.deviceId || seenIds.has(device.deviceId)) return;

      seenIds.add(device.deviceId);

      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = getAudioOutputLabel(device);

      select.appendChild(option);
    });

    /*
     * If Windows disconnected the previously saved speaker, don't leave
     * a dead selection in the UI.
     */
    const stillExists =
      currentId === 'default' ||
      audioOutputDevices.some(device => device.deviceId === currentId);

    if (!stillExists){
      settings.audioOutputId = 'default';
      settings.audioOutputLabel = 'System Default';
      saveSettings();
    }

    select.value = stillExists ? currentId : 'default';

    const status = document.getElementById('audioOutputStatus');

    if (status){
      status.textContent = supportsAudioOutputSelection()
        ? 'Ready'
        : 'Not supported';
    }
  }

  function syncAudioOutputControls(){
    createAudioOutputControls();

    const select = document.getElementById('audioOutputSelect');
    if (!select) return;

    renderAudioOutputDevices();

    const desired = settings.audioOutputId || 'default';

    if ([...select.options].some(option => option.value === desired)){
      select.value = desired;
    } else {
      select.value = 'default';
    }
  }

  async function refreshAudioOutputDevices(){
    createAudioOutputControls();

    const status = document.getElementById('audioOutputStatus');

    if (status){
      status.textContent = 'Scanning…';
    }

    await enumerateAudioOutputs();

    /*
     * Re-apply the saved device after enumeration because Chromium can
     * expose the output list asynchronously after the window starts.
     */
    const desired = settings.audioOutputId || 'default';
    const success = await applyAudioOutputDevice(desired, {
      skipSave: true
    });

    if (status){
      status.textContent = success ? 'Active' : 'Unavailable';
    }
  }

  function startAudioOutputMonitoring(){
    if (!navigator.mediaDevices) return;

    if (typeof navigator.mediaDevices.addEventListener === 'function'){
      navigator.mediaDevices.addEventListener(
        'devicechange',
        () => {
          clearTimeout(audioOutputRefreshTimer);

          audioOutputRefreshTimer = setTimeout(() => {
            enumerateAudioOutputs();
          }, 250);
        }
      );
    }

    enumerateAudioOutputs();
  }
  function loadSettings(){
    try{
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    }catch(e){ settings = Object.assign({}, DEFAULT_SETTINGS); }
  }
  function saveSettings(){
    try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){}
  }

  function savePlaybackState(){
    try {
      const currentTrack = currentIndex >= 0 ? playlist[currentIndex] : null;
      const currentDuration = currentEngine === 'wasm' ? (wasmBuffer ? wasmBuffer.duration : 0) : (mediaEl && mediaEl.duration ? mediaEl.duration : 0);
      const currentTime = currentEngine === 'wasm'
        ? (wasmPlaying ? getWasmCurrentTime() : wasmOffset)
        : (mediaEl ? mediaEl.currentTime || 0 : 0);
      const payload = {
        id: currentTrack ? currentTrack.id : null,
        title: currentTrack ? currentTrack.title : 'Nothing playing',
        kind: currentTrack ? currentTrack.kind : null,
        artist: currentTrack ? (currentTrack.artist || null) : null,
        album: currentTrack ? (currentTrack.album || null) : null,
        year: currentTrack ? (currentTrack.year || null) : null,
        genre: currentTrack ? (currentTrack.genre || null) : null,
        thumbUrl: currentTrack ? (currentTrack.thumbUrl || (albumArtForTrack(currentTrack) || {}).url || null) : null,
        isPlaying: currentTrack ? ((currentEngine === 'wasm' && wasmPlaying) || (currentEngine !== 'wasm' && !mediaEl.paused)) : false,
        currentTime,
        duration: currentDuration,
        volume: parseFloat(volBar.value) || 0,
        speed: currentSpeed,
        updatedAt: Date.now(),
      };
      localStorage.setItem(MINI_STATE_KEY, JSON.stringify(payload));
      if (miniPlayerWindow && !miniPlayerWindow.closed) {
        try { miniPlayerWindow.postMessage({ source: 'sleeve-main-player' }, window.location.origin); } catch (e) {}
      }
    } catch (e) {}
  }

  function handleMiniPlayerAction(action, value){
    if (!action) return;
    const track = currentIndex >= 0 ? playlist[currentIndex] : null;
    switch (action){
      case 'togglePlay':
        if (currentIndex === -1){
          const order = getQueueOrder();
          if (order.length > 0) playTrackAt(order[0], true);
        } else {
          playBtn.click();
        }
        break;
      case 'prev':
        if (track) prevBtn.click();
        break;
      case 'next':
        if (track) nextBtn.click();
        break;
      case 'seek':
        if (track && Number.isFinite(Number(value))){
          if (currentEngine === 'wasm') wasmSeek(Number(value));
          else mediaEl.currentTime = Number(value);
        }
        break;
      case 'volume':
        if (Number.isFinite(Number(value))) setVolume(Number(value));
        break;
      default:
        break;
    }
  }

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'sleeve-mini-player') return;
    handleMiniPlayerAction(event.data.action, event.data.value);
  });

  const root = document.documentElement;

  function applySettings(){
    const accent = settings.accent === 'custom' && settings.accentCustom
      ? deriveAccentFromCustom(settings.accentCustom)
      : (ACCENTS[settings.accent] || ACCENTS.cyan);
    root.style.setProperty('--accent-blue', accent.blue);
    root.style.setProperty('--accent-blue-bright', accent.bright);
    root.style.setProperty('--accent-ice', accent.ice);

    const theme = THEMES[settings.theme] || THEMES.navy;
    root.style.setProperty('--bg', theme.bg);
    root.style.setProperty('--bg-sidebar', theme.bgSidebar);
    root.style.setProperty('--bg-elevated', theme.bgElevated);
    root.style.setProperty('--bg-elevated-2', theme.bgElevated2);
    root.style.setProperty('--bg-card', theme.bgCard);
    root.style.setProperty('--bg-card-hover', theme.bgCardHover);
    root.style.setProperty('--text', theme.text || '#eef1f6');
    root.style.setProperty('--text-dim', theme.textDim || '#93a0b8');
    root.style.setProperty('--text-dimmer', theme.textDimmer || '#5a6b88');

    root.style.setProperty('--radius-card', `${settings.radius}px`);
    root.style.setProperty('--radius-thumb', `${settings.thumbRadius ?? settings.radius}px`);
    root.style.setProperty('--radius-preview', `${settings.previewRadius ?? settings.radius}px`);
    root.style.setProperty('--playlist-thumb-size', `${settings.playlistThumbSize ?? 24}px`);
    root.style.setProperty('--library-thumb-size', `${settings.libraryThumbSize ?? 34}px`);
    root.style.setProperty('--sidebar-width', `${settings.sidebarWidth ?? 260}px`);
    root.style.setProperty('--shadow-card', settings.cardShadow === false ? 'none' : '0 10px 24px rgba(0,0,0,0.35)');
    root.style.setProperty('--shadow-lift', settings.cardShadow === false ? 'none' : '0 18px 36px rgba(0,0,0,0.5)');
    root.style.setProperty('--line', settings.hairlines === false ? 'transparent' : 'rgba(220,230,245,0.08)');
    document.body.style.zoom = (settings.uiScale ?? 100) / 100;

    document.body.classList.toggle('style-glass', settings.cardStyle === 'glass');
    document.body.classList.toggle('style-flat', settings.cardStyle === 'flat');
    document.body.classList.toggle('style-outline', settings.cardStyle === 'outline');
    document.body.classList.toggle('compact-cards', !!settings.compactCards);
    document.body.classList.toggle('no-card-lift', !!settings.noCardLift);
    document.body.classList.toggle('soft-atmosphere', !!settings.atmosphere);
    document.body.classList.toggle('high-contrast', !!settings.highContrast);
    document.body.classList.toggle('patterned-page', !!settings.pattern);
    document.body.classList.toggle('theme-paper', settings.theme === 'paper');
    document.body.classList.toggle('thumbnail-fit', settings.thumbnailFit === 'contain');
    document.body.classList.toggle('font-sans', settings.font === 'sans');
    document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
    document.body.classList.toggle('row-compact', settings.rowDensity === 'compact');
    document.body.classList.toggle('bold-titles', !!settings.boldTitles);
    document.body.classList.toggle('active-glow', !!settings.activeGlow);
    document.body.classList.toggle('sidebar-blur', !!settings.sidebarBlur);
    document.body.classList.toggle('top-page-navigation', !!settings.topPageNavigation);
    
    document.body.classList.toggle('preset-sleeve', settings.appPreset === 'sleeve');
    document.body.classList.toggle('preset-spotify', settings.appPreset === 'spotify');
    document.body.classList.toggle('preset-amazonMusic', settings.appPreset === 'amazonMusic');
    
    cardGrid.classList.toggle('view-list', settings.view === 'list');
    cardGrid.classList.toggle('view-shelf', settings.view === 'shelf');
    if (settings.view === 'grid' || settings.view === 'shelf'){
      cardGrid.style.gridTemplateColumns = settings.view === 'shelf'
        ? ''
        : `repeat(auto-fill, minmax(${settings.cardSize}px, 1fr))`;
    }
    cardGrid.style.gap = `${settings.cardGap}px`;

    stagePanel.style.display = settings.showStage ? '' : 'none';
    setVideoMode(settings.videoSize);
  }

  function syncDrawerControls(){
    document.querySelectorAll('#accentSwatches .swatch').forEach(el => {
      el.classList.toggle('active', settings.accent === el.dataset.accent);
    });
    document.querySelectorAll('#themeSwatches .theme-swatch').forEach(el => {
      el.classList.toggle('active', settings.theme === el.dataset.theme);
    });
    document.getElementById('accentCustom').value = settings.accentCustom || '#17abe8';
    document.getElementById('radiusRange').value = settings.radius;
    document.getElementById('radiusValue').textContent = settings.radius;
    document.getElementById('thumbRadiusRange').value = settings.thumbRadius ?? settings.radius;
    document.getElementById('thumbRadiusValue').textContent = settings.thumbRadius ?? settings.radius;
    document.getElementById('previewRadiusRange').value = settings.previewRadius ?? settings.radius;
    document.getElementById('previewRadiusValue').textContent = settings.previewRadius ?? settings.radius;
    document.getElementById('playlistThumbSizeRange').value = settings.playlistThumbSize ?? 24;
    document.getElementById('playlistThumbSizeValue').textContent = `${settings.playlistThumbSize ?? 24}px`;
    document.getElementById('libraryThumbSizeRange').value = settings.libraryThumbSize ?? 34;
    document.getElementById('libraryThumbSizeValue').textContent = `${settings.libraryThumbSize ?? 34}px`;
    document.getElementById('sizeRange').value = settings.cardSize;
    document.getElementById('sizeValue').textContent = settings.cardSize;
    document.getElementById('gapRange').value = settings.cardGap;
    document.getElementById('gapValue').textContent = settings.cardGap;
    document.getElementById('sidebarWidthRange').value = settings.sidebarWidth ?? 260;
    document.getElementById('sidebarWidthValue').textContent = `${settings.sidebarWidth ?? 260}px`;
    document.getElementById('miniPlayerScaleRange').value = settings.miniPlayerScale ?? 100;
    document.getElementById('miniPlayerScaleValue').textContent = `${settings.miniPlayerScale ?? 100}%`;
    document.getElementById('toggleTopPageNavigation').checked = !!settings.topPageNavigation;
    document.getElementById('uiScaleRange').value = settings.uiScale ?? 100;
    document.getElementById('uiScaleValue').textContent = `${settings.uiScale ?? 100}%`;
    document.getElementById('toggleStage').checked = settings.showStage;
    document.getElementById('toggleAutoplay').checked = settings.autoplayNext;
    document.getElementById('toggleReduceMotion').checked = settings.reduceMotion;
    document.getElementById('toggleDetailedAlbum').checked = settings.detailedAlbumView;
    document.getElementById('toggleAlbumTrackOrder').checked = settings.albumTrackOrder;
    document.getElementById('toggleAlbumArtThumb').checked = settings.albumArtAsTrackThumb;
    document.getElementById('toggleCompactCards').checked = !!settings.compactCards;
    document.getElementById('toggleNoCardLift').checked = !!settings.noCardLift;
    document.getElementById('toggleAtmosphere').checked = !!settings.atmosphere;
    document.getElementById('toggleHighContrast').checked = !!settings.highContrast;
    document.getElementById('togglePattern').checked = !!settings.pattern;
    document.getElementById('toggleNowPlayingThumb').checked = !!settings.nowPlayingThumb;
    document.getElementById('toggleCardShadow').checked = settings.cardShadow !== false;
    document.getElementById('toggleBoldTitles').checked = !!settings.boldTitles;
    document.getElementById('toggleHairlines').checked = settings.hairlines !== false;
    document.getElementById('toggleActiveGlow').checked = !!settings.activeGlow;
    document.getElementById('toggleSidebarBlur').checked = !!settings.sidebarBlur;
    setSegmented('cardStyleSeg', settings.cardStyle);
    setSegmented('fontSeg', settings.font);
    setSegmented('viewSeg', settings.view);
    setSegmented('thumbnailFitSeg', settings.thumbnailFit || 'cover');
    setSegmented('rowDensitySeg', settings.rowDensity || 'comfortable');
    setSegmented('appStyleSeg', settings.appPreset || 'sleeve');
  }

  function setSegmented(id, value){
    document.querySelectorAll(`#${id} button`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === value);
    });
  }

  function updateSetting(patch){
    Object.assign(settings, patch);
    saveSettings();
    applySettings();
  }

  function applyPreset(key){
    const preset = APP_PRESETS[key];
    if (!preset) return;
    updateSetting(Object.assign({ appPreset: key }, preset));
    syncDrawerControls();
  }

  // Drawer open/close
  const navCustomize = document.getElementById('navCustomize');
  const mainNav = document.querySelector('.sidebar .nav');
  const topPageNav = document.getElementById('topPageNav');
  const topPageNavItems = [
    document.getElementById('navHome'),
    document.getElementById('navArtists'),
    document.getElementById('navBrowse')
  ];
  const customizeDrawer = document.getElementById('customizeDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawerClose = document.getElementById('drawerClose');

  function openDrawer(){
    customizeDrawer.classList.add('open');
    drawerOverlay.classList.add('open');
    navCustomize.classList.add('active');

    createAudioOutputControls();
    syncDrawerControls();
    syncAudioOutputControls();

    renderStats();
}
  function applyTopPageNavigation(){
    if (!mainNav || !topPageNav) return;
    if (settings.topPageNavigation) {
      topPageNavItems.forEach(item => topPageNav.appendChild(item));
    } else {
      topPageNavItems.forEach(item => mainNav.insertBefore(item, navCustomize));
    }
  }
  function closeDrawer(){
    customizeDrawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
    navCustomize.classList.remove('active');
  }
  navCustomize.addEventListener('click', () => {
    if (customizeDrawer.classList.contains('open')) closeDrawer(); else openDrawer();
  });
  drawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  // App style presets
  document.querySelectorAll('#appStyleSeg button').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.value));
  });

  // Accent swatches
  document.querySelectorAll('#accentSwatches .swatch').forEach(el => {
    el.addEventListener('click', () => {
      updateSetting({ accent: el.dataset.accent });
      syncDrawerControls();
    });
  });
  document.getElementById('accentCustom').addEventListener('input', (e) => {
    updateSetting({ accent: 'custom', accentCustom: e.target.value });
    syncDrawerControls();
  });

  // Theme swatches
  document.querySelectorAll('#themeSwatches .theme-swatch').forEach(el => {
    el.addEventListener('click', () => {
      updateSetting({ theme: el.dataset.theme });
      syncDrawerControls();
    });
  });

  // Corner roundness
  document.getElementById('radiusRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('radiusValue').textContent = v;
    updateSetting({ radius: v });
  });

  // Card style / font / view segmented controls
  document.querySelectorAll('#cardStyleSeg button').forEach(btn => {
    btn.addEventListener('click', () => { updateSetting({ cardStyle: btn.dataset.value }); setSegmented('cardStyleSeg', btn.dataset.value); });
  });
  document.querySelectorAll('#fontSeg button').forEach(btn => {
    btn.addEventListener('click', () => { updateSetting({ font: btn.dataset.value }); setSegmented('fontSeg', btn.dataset.value); });
  });
  document.querySelectorAll('#viewSeg button').forEach(btn => {
    btn.addEventListener('click', () => { updateSetting({ view: btn.dataset.value }); setSegmented('viewSeg', btn.dataset.value); });
  });
  document.querySelectorAll('#thumbnailFitSeg button').forEach(btn => {
    btn.addEventListener('click', () => {
      updateSetting({ thumbnailFit: btn.dataset.value });
      setSegmented('thumbnailFitSeg', btn.dataset.value);
    });
  });

  // Card size / spacing
  document.getElementById('sizeRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('sizeValue').textContent = v;
    updateSetting({ cardSize: v });
    queueVirtualScrollRender();
  });
  document.getElementById('gapRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('gapValue').textContent = v;
    updateSetting({ cardGap: v });
    queueVirtualScrollRender();
  });
  document.getElementById('sidebarWidthRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('sidebarWidthValue').textContent = `${v}px`;
    updateSetting({ sidebarWidth: v });
    queueVirtualScrollRender();
  });

  // Toggles
  document.getElementById('toggleStage').addEventListener('change', (e) => updateSetting({ showStage: e.target.checked }));
  document.getElementById('toggleAutoplay').addEventListener('change', (e) => updateSetting({ autoplayNext: e.target.checked }));
  document.getElementById('toggleReduceMotion').addEventListener('change', (e) => updateSetting({ reduceMotion: e.target.checked }));
  document.getElementById('toggleDetailedAlbum').addEventListener('change', (e) => {
    updateSetting({ detailedAlbumView: e.target.checked });
    scheduleRender(searchInput.value);
  });
  document.getElementById('toggleAlbumTrackOrder').addEventListener('change', (e) => {
    updateSetting({ albumTrackOrder: e.target.checked });
    scheduleRender(searchInput.value);
  });
  document.getElementById('toggleAlbumArtThumb').addEventListener('change', (e) => {
    updateSetting({ albumArtAsTrackThumb: e.target.checked });
    scheduleRender(searchInput.value);
    if (currentIndex >= 0) updateNowPlayingArt(playlist[currentIndex]);
    savePlaybackState();
  });
  document.getElementById('toggleCompactCards').addEventListener('change', (e) => updateSetting({ compactCards: e.target.checked }));
  document.getElementById('toggleNoCardLift').addEventListener('change', (e) => updateSetting({ noCardLift: e.target.checked }));
  document.getElementById('toggleAtmosphere').addEventListener('change', (e) => updateSetting({ atmosphere: e.target.checked }));
  document.getElementById('toggleHighContrast').addEventListener('change', (e) => updateSetting({ highContrast: e.target.checked }));
  document.getElementById('togglePattern').addEventListener('change', (e) => updateSetting({ pattern: e.target.checked }));
  document.getElementById('toggleNowPlayingThumb').addEventListener('change', (e) => {
    updateSetting({ nowPlayingThumb: e.target.checked });
    if (currentIndex !== -1) updateNowPlayingArt(playlist[currentIndex]);
  });
  document.getElementById('miniPlayerScaleRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('miniPlayerScaleValue').textContent = `${v}%`;
    updateSetting({ miniPlayerScale: v });
    if (miniPlayerWindow && !miniPlayerWindow.closed) {
      const { width, height } = getMiniPlayerWindowDimensions();
      try { miniPlayerWindow.resizeTo(width, height); } catch (e) {}
    }
  });

  // Thumbnail roundness (separate from overall corner roundness)
  document.getElementById('thumbRadiusRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('thumbRadiusValue').textContent = v;
    updateSetting({ thumbRadius: v });
  });
  document.getElementById('previewRadiusRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('previewRadiusValue').textContent = v;
    updateSetting({ previewRadius: v });
  });

  // Playlist thumbnail size (the small square art next to each playlist in the sidebar)
  document.getElementById('playlistThumbSizeRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('playlistThumbSizeValue').textContent = `${v}px`;
    updateSetting({ playlistThumbSize: v });
  });
  document.getElementById('libraryThumbSizeRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('libraryThumbSizeValue').textContent = `${v}px`;
    updateSetting({ libraryThumbSize: v });
  });

  // Overall app scale (zoom)
  document.getElementById('uiScaleRange').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('uiScaleValue').textContent = `${v}%`;
    updateSetting({ uiScale: v });
  });

  // More customization toggles
  document.getElementById('toggleCardShadow').addEventListener('change', (e) => updateSetting({ cardShadow: e.target.checked }));
  document.getElementById('toggleBoldTitles').addEventListener('change', (e) => updateSetting({ boldTitles: e.target.checked }));
  document.getElementById('toggleHairlines').addEventListener('change', (e) => updateSetting({ hairlines: e.target.checked }));
  document.getElementById('toggleActiveGlow').addEventListener('change', (e) => updateSetting({ activeGlow: e.target.checked }));
  document.getElementById('toggleSidebarBlur').addEventListener('change', (e) => updateSetting({ sidebarBlur: e.target.checked }));
  document.getElementById('toggleTopPageNavigation').addEventListener('change', (e) => {
    updateSetting({ topPageNavigation: e.target.checked });
    applyTopPageNavigation();
  });

  // Sidebar row density
  document.querySelectorAll('#rowDensitySeg button').forEach(btn => {
    btn.addEventListener('click', () => {
      updateSetting({ rowDensity: btn.dataset.value });
      setSegmented('rowDensitySeg', btn.dataset.value);
    });
  });

  document.getElementById('resetSettingsBtn').addEventListener('click', () => {
    settings = Object.assign({}, DEFAULT_SETTINGS);
    saveSettings();
    applySettings();
    syncDrawerControls();
    applyTopPageNavigation();
  });

 loadSettings();
applySettings();
applyTopPageNavigation();

createAudioOutputControls();
startAudioOutputMonitoring();


  const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
  const ICON_PAUSE = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
  const NOTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const FILM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>';
  const PERSON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>';
  const CALENDAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  const GENRE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L4 3v5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l3.59-3.59a2 2 0 0 0 0-2.83z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg>';

  function iconFor(kind){ return kind === 'video' ? FILM_ICON : NOTE_ICON; }

  addBtn.addEventListener('click', () => fileInput.click());
  addBtnEmpty.addEventListener('click', () => fileInput.click());

  // ---------- Folder import ----------
  // webkitdirectory makes the browser return every file inside the
  // selected folder, including files in nested subfolders.
  function openFolderPicker(){
    folderInput.value = '';
    folderInput.click();
  }

  addFolderBtn.addEventListener('click', openFolderPicker);
  addFolderBtnEmpty.addEventListener('click', openFolderPicker);

  folderInput.addEventListener('change', (e) => {
    addFiles(e.target.files);
    folderInput.value = '';
  });

  clearThumbsBtn.addEventListener('click', async () => {
    if (!confirm('Remove every thumbnail — from every track, album, and artist? This cannot be undone.')) return;

    // Track thumbnails.
    playlist.forEach(track => {
      if (!track.thumb && !track.thumbUrl) return;
      if (track.thumbUrl){ try{ URL.revokeObjectURL(track.thumbUrl); }catch(err){} }
      track.thumb = null;
      track.thumbUrl = null;
      track.thumbKind = null;
      dbPut(track);
    });

    // Album thumbnails.
    albumThumbs.forEach(entry => {
      if (entry && entry.url){ try{ URL.revokeObjectURL(entry.url); }catch(err){} }
    });
    albumThumbs.clear();
    await dbClearAlbumThumbs();

    // Artist thumbnails.
    artistThumbs.forEach(entry => {
      if (entry && entry.url){ try{ URL.revokeObjectURL(entry.url); }catch(err){} }
    });
    artistThumbs.clear();
    await dbClearArtistThumbs();

    if (currentIndex !== -1) updateNowPlayingArt(playlist[currentIndex]);
    savePlaybackState();
    scheduleRender(searchInput.value);
  });

  clearLibraryBtn.addEventListener('click', async () => {
    if (!confirm('Remove everything from your saved library? This cannot be undone.')) return;
    stopEverything();
    playlist = [];
    currentIndex = -1;
    npTitle.textContent = 'Nothing playing';
    npSub.textContent = '—';
    stageTitle.textContent = 'Nothing playing';
    stageSub.textContent = 'Pick a track from your shelf below';
    stageBadge.style.display = 'none';
    stageVisual.classList.remove('has-video');
    updateNowPlayingArt(null);
    stagePanel.classList.remove('has-video');
    mediaEl.controls = false;
    videoPipBtn.style.display = 'none';
    updateLyricsToggleVisibility();
    if (lyricsPanelOpen) renderLyricsPanel();
    await dbClear();
    scheduleRender(searchInput.value);
  });

  function classifyFile(file){
    const name = file.name.toLowerCase();
    const type = file.type || '';
    if (type.startsWith('video/') || /\.(mp4|m4v|mov|mkv|ogv|avi|webm|3gp|mpeg|mpg|ts|m2ts|wmv|flv)$/.test(name)) return 'video';
    if (type === 'audio/flac' || type === 'audio/x-flac' || /\.flac$/.test(name)) return 'flac';
    return 'audio';
  }

  function addFiles(fileList){
    const files = Array.from(fileList || []).filter(f => {
      const type = f.type || '';
      return type.startsWith('audio/') || type.startsWith('video/') || classifyFile(f) !== 'audio' || /\.(mp3|wav|ogg|oga|m4a|aac|flac|wma|opus|webm|aiff|aif|amr|3gp|mid|midi|mp4|m4v|mov|mkv|ogv|avi|mpeg|mpg|ts|m2ts|wmv|flv)$/i.test(f.name);
    });
    if (files.length === 0) return;
    const newTracks = [];
    files.forEach((file) => {
      const rawName = file.name.replace(/\.[^/.]+$/, '');
      const url = URL.createObjectURL(file);
      const track = {
        id: nextId++,
        file,
        url,
        title: rawName,
        kind: classifyFile(file),
        error: false,
        loading: false,
        wasmBuffer: null,
        thumb: null,
        thumbUrl: null,
        thumbKind: null,
        lyrics: null,
        artist: null,
        album: null,
        year: null,
        genre: null,
        trackNum: null,
        duration: null,
        musicBrainzReleaseId: null,
        manualMetadata: {},
        playCount: 0,
        lastPlayedAt: null,
        addedAt: Date.now(),
        sourcePath: window.electronAPI?.getPathForFile
          ? window.electronAPI.getPathForFile(file)
          : (file.webkitRelativePath || file.path || file.name || '')
      };
      playlist.push(track);
      newTracks.push(track);
      dbPut(track);
    });
    scheduleRender(searchInput.value);
    let cursor = 0;
    const scanBatch = () => {
      const end = Math.min(cursor + 12, newTracks.length);
     for (; cursor < end; cursor++){
  const track = newTracks[cursor];

  readTags(track);

  setTimeout(() => {
    autoFetchAlbumArt(track);
  }, 800 + cursor * 200);
}

      if (cursor < newTracks.length) setTimeout(scanBatch, 0);
    };
    scanBatch();
    if (currentIndex === -1 && playlist.length > 0) loadTrack(0, false);
    scheduleDupeCheck();
  }

  // ---------- Artist/album tag reading ----------
  // Reads ID3 (or similar) tags from the file itself so tracks can be
  // grouped by artist/album without the user typing anything in.
  function readTags(track){
    if (track.kind === 'video') return;
    if (typeof jsmediatags === 'undefined') return;
    jsmediatags.read(track.file, {
      onSuccess: (tag) => {
        const tags = (tag && tag.tags) || {};
        const artist = (tags.artist || '').trim();
        const album = (tags.album || '').trim();
        const genre = (tags.genre || '').trim();
        const yearRaw = (tags.year || '').toString().trim();
        const year = (yearRaw.match(/\d{4}/) || [])[0] || null;
        const trackRaw = (tags.track || '').toString().trim();
        const trackNum = trackRaw ? (parseInt(trackRaw, 10) || null) : null;
        // Also try to extract embedded cover art from the file tags
        const picture = tags.picture;
        if (picture && !track.thumb && !track.thumbUrl){
          try {
            const byteArray = new Uint8Array(picture.data);
            const mimeType = picture.format || 'image/jpeg';
            const blob = new Blob([byteArray], { type: mimeType });
            makeThumbBlob(blob).then(thumbBlob => {
              if (!track.thumb && !track.thumbUrl){
                track.thumb = thumbBlob;
                track.thumbUrl = URL.createObjectURL(thumbBlob);
                track.thumbKind = 'image';
                dbPut(track);
                if (currentIndex !== -1 && playlist[currentIndex].id === track.id) updateNowPlayingArt(track);
                scheduleRender(searchInput.value);
              }
            }).catch(() => {});
          } catch(e) {}
        }
        let changed = false;
        const manual = track.manualMetadata || {};
        if (!manual.artist && artist && artist !== track.artist){ track.artist = artist; changed = true; }
        if (!manual.album && album && album !== track.album){ track.album = album; changed = true; }
        if (!manual.genre && genre && genre !== track.genre){ track.genre = genre; changed = true; }
        if (!manual.year && year && year !== track.year){ track.year = year; changed = true; }
        if (trackNum != null && trackNum !== track.trackNum){ track.trackNum = trackNum; changed = true; }
        if (changed){
          dbPut(track);
          if (currentView.type === 'artists' || currentView.type === 'artistAlbums' || currentView.type === 'album'){
            scheduleRender(searchInput.value);
          }
        }
        // After file tags are read, if core fields are still missing, try MusicBrainz
        const stillMissingCore = !track.artist || !track.album || !track.year;
        if (stillMissingCore) autoFetchMetadata(track);
      },
      onError: () => {
        // File has no readable tags — try MusicBrainz using the filename as a hint
        autoFetchMetadata(track);
      }
    });
  }

  // ---------- MusicBrainz metadata auto-fetch ----------
  // Fires after readTags when artist/album/year are still missing.
  // Non-blocking, never overwrites manual overrides or tags already found.
 // ---------- MusicBrainz auto-fetch ----------

const metadataFetchAttempts = new Map();


// MusicBrainz asks clients to stay at or below 1 request per second.
// Everything goes through this queue so importing a large library does
// not hammer MusicBrainz.
const musicBrainzQueue = [];
let musicBrainzProcessing = false;

function queueMusicBrainzRequest(requestFn) {
  return new Promise((resolve, reject) => {
    musicBrainzQueue.push({
      requestFn,
      resolve,
      reject
    });

    processMusicBrainzQueue();
  });
}

async function processMusicBrainzQueue() {
  if (musicBrainzProcessing) return;

  musicBrainzProcessing = true;

  while (musicBrainzQueue.length > 0) {
    const job = musicBrainzQueue.shift();

    try {
      const result = await job.requestFn();
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    }

    // Keep requests safely spaced apart.
    if (musicBrainzQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  }

  musicBrainzProcessing = false;
}


// Cleans titles that commonly come from filenames.
//
// Examples:
//
// "(2004) 02 69 Tea"        -> "69 Tea"
// "02 - Duality"            -> "Duality"
// "02. Duality"             -> "Duality"
// "69 Tea"                  -> "69 Tea"
// "Duality (2004)"          -> "Duality"
// "Duality (Clean)"         -> "Duality"
//
// IMPORTANT:
// We only remove a number when it actually looks like a track number.
// A title such as "69 Tea" is preserved.
function cleanMusicBrainzTitle(title) {
  let value = String(title || '').trim();

  // Remove a year at the beginning.
  value = value.replace(
    /^\s*\(\s*(?:19|20)\d{2}\s*\)\s*/i,
    ''
  );

  // Remove a leading track number ONLY when it has a separator.
  //
  // 02 - Song
  // 02. Song
  // 02) Song
  //
  // This is deliberately NOT:
  //
  // /^\d+\s+/
  //
  // because that would incorrectly turn "69 Tea" into "Tea".
  value = value.replace(
    /^\s*\d{1,3}\s*[-–—.)_:]\s*/,
    ''
  );

  // Handle filenames such as:
  //
  // "02 69 Tea"
  //
  // but don't strip:
  //
  // "69 Tea"
  //
  // We only do this when there is a strong indication that the first
  // number is a track number.
  const doubleNumberMatch = value.match(
    /^\s*(\d{1,3})\s+(\d{1,3})\s+(.+)$/i
  );

  if (doubleNumberMatch) {
    const firstNumber = Number(doubleNumberMatch[1]);

    if (firstNumber >= 1 && firstNumber <= 99) {
      value = `${doubleNumberMatch[2]} ${doubleNumberMatch[3]}`;
    }
  }

  // Remove a year at the end.
  value = value.replace(
    /\s*\(\s*(?:19|20)\d{2}\s*\)\s*$/i,
    ''
  );

  // Remove clean / clean version tags.
  value = value.replace(
    /\s*[\[(]\s*clean(?:\s+version)?\s*[\])]\s*$/i,
    ''
  );

  return value.trim();
}


function normalizeMusicBrainzText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}


function musicBrainzTitleMatches(a, b) {
  const left = normalizeMusicBrainzText(a);
  const right = normalizeMusicBrainzText(b);

  if (!left || !right) return false;

  if (left === right) return true;

  return (
    left.includes(right) ||
    right.includes(left)
  );
}


function getMusicBrainzArtistName(recording) {
  return (
    recording?.['artist-credit']
      ?.map(credit => credit?.name || credit?.artist?.name || '')
      .filter(Boolean)
      .join(', ')
      .trim() || ''
  );
}


function getMusicBrainzReleaseYear(release) {
  const date =
    release?.date ||
    release?.['release-events']?.[0]?.date ||
    '';

  return (String(date).match(/\b(19|20)\d{2}\b/) || [])[0] || null;
}


function chooseBestMusicBrainzRecording(recordings, track) {
  if (!Array.isArray(recordings) || recordings.length === 0) {
    return null;
  }

  const artist = normalizeMusicBrainzText(track.artist);
  const title = normalizeMusicBrainzText(
    cleanMusicBrainzTitle(track.title)
  );

  let best = null;
  let bestScore = -Infinity;

  for (const recording of recordings) {
    const recordingTitle = normalizeMusicBrainzText(
      recording?.title
    );

    const recordingArtist = normalizeMusicBrainzText(
      getMusicBrainzArtistName(recording)
    );

    let score = 0;

    // Title is the most important part.
    if (recordingTitle === title) {
      score += 100;
    } else if (musicBrainzTitleMatches(recordingTitle, title)) {
      score += 50;
    }

    // Artist match is very important when we already have an artist.
    if (artist && recordingArtist === artist) {
      score += 100;
    } else if (
      artist &&
      (
        recordingArtist.includes(artist) ||
        artist.includes(recordingArtist)
      )
    ) {
      score += 50;
    }

    // Prefer recordings that actually have releases.
    if (Array.isArray(recording.releases) && recording.releases.length) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = recording;
    }
  }

  // Don't accept a completely unrelated MusicBrainz result.
  if (bestScore < 50) {
    return null;
  }

  return best;
}


async function musicBrainzRecordingSearch(track) {
  const cleanedTitle = cleanMusicBrainzTitle(track.title);

  if (!cleanedTitle) return null;

  const artist = String(track.artist || '').trim();

  const searches = [];

  // First choice: artist + recording title.
  if (artist) {
    searches.push(
      `recording:"${cleanedTitle}" AND artist:"${artist}"`
    );
  }

  // Fallback: title only.
  searches.push(
    `recording:"${cleanedTitle}"`
  );

  for (const searchQuery of searches) {
    try {
      const url =
        `https://musicbrainz.org/ws/2/recording/` +
        `?query=${encodeURIComponent(searchQuery)}` +
        `&limit=10` +
        `&fmt=json`;

      const response = await queueMusicBrainzRequest(() =>
        fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Sleeve/1.0 (music player app)'
          }
        })
      );

      if (!response.ok) {
        console.debug(
          `[Sleeve] MusicBrainz HTTP ${response.status} for "${cleanedTitle}"`
        );
        continue;
      }

      const data = await response.json();

      const recording = chooseBestMusicBrainzRecording(
        data?.recordings || [],
        track
      );

      if (recording) {
        return recording;
      }
    } catch (err) {
      console.debug(
        `[Sleeve] MusicBrainz search failed for "${cleanedTitle}":`,
        err?.message || err
      );
    }
  }

  return null;
}


async function autoFetchMetadata(track) {
  if (!track || track.kind === 'video') return;

  if (metadataFetchAttempts.get(track.id)) return;

  const title = String(track.title || '').trim();

  if (!title) return;

  const manual = track.manualMetadata || {};

  const needsArtist =
    !manual.artist &&
    !track.artist;

  const needsAlbum =
    !manual.album &&
    !track.album;

  const needsYear =
    !manual.year &&
    !track.year;

  const needsGenre =
    !manual.genre &&
    !track.genre;

  const needsMusicBrainzId =
    !track.musicBrainzReleaseId;

  if (
    !needsArtist &&
    !needsAlbum &&
    !needsYear &&
    !needsGenre &&
    !needsMusicBrainzId
  ) {
    return;
  }

  metadataFetchAttempts.set(track.id, true);

  try {
    const recording = await musicBrainzRecordingSearch(track);

    if (!recording) {
      console.debug(
        `[Sleeve] No MusicBrainz match for "${track.title}"`
      );
      return;
    }

    let changed = false;

    // ---------------------------------------------------------
    // Artist
    // ---------------------------------------------------------

    if (!manual.artist && !track.artist) {
      const artistName = getMusicBrainzArtistName(recording);

      if (artistName) {
        track.artist = artistName;
        changed = true;
      }
    }

    // ---------------------------------------------------------
    // Album / release
    // ---------------------------------------------------------

    const releases = Array.isArray(recording.releases)
      ? recording.releases
      : [];

    // Prefer a release with an actual title and date.
    const release =
      releases.find(r => r?.title && r?.date) ||
      releases.find(r => r?.title) ||
      releases[0] ||
      null;

    if (release) {
      // SAVE THE RELEASE MBID.
      //
      // This is important because Cover Art Archive uses the
      // release MBID to find the artwork.
      if (
        release.id &&
        track.musicBrainzReleaseId !== release.id
      ) {
        track.musicBrainzReleaseId = release.id;
        changed = true;
      }

      // Album
      if (!manual.album && !track.album && release.title) {
        track.album = String(release.title).trim();

        if (track.album) {
          changed = true;
        }
      }

      // Year
      if (!manual.year && !track.year) {
        const year = getMusicBrainzReleaseYear(release);

        if (year) {
          track.year = year;
          changed = true;
        }
      }
    }

    // ---------------------------------------------------------
    // Genre
    // ---------------------------------------------------------

    if (!manual.genre && !track.genre) {
      const tags = Array.isArray(recording.tags)
        ? recording.tags.slice()
        : [];

      tags.sort(
        (a, b) =>
          Number(b?.count || 0) -
          Number(a?.count || 0)
      );

      const genre = String(tags[0]?.name || '').trim();

      if (genre) {
        track.genre = genre;
        changed = true;
      }
    }

    // ---------------------------------------------------------
    // Save metadata
    // ---------------------------------------------------------

    if (changed) {
      await dbPut(track);

      console.debug(
        `[Sleeve] MusicBrainz enriched "${track.title}":`,
        {
          artist: track.artist,
          album: track.album,
          year: track.year,
          genre: track.genre,
          musicBrainzReleaseId: track.musicBrainzReleaseId
        }
      );

      if (
        currentView.type === 'artists' ||
        currentView.type === 'artistAlbums' ||
        currentView.type === 'album' ||
        currentView.type === 'home'
      ) {
        scheduleRender(searchInput.value);
      }

      if (
        currentIndex !== -1 &&
        playlist[currentIndex]?.id === track.id
      ) {
        updateNowPlayingText(track, currentIndex);
      }
    }

    // ALWAYS attempt artwork after MusicBrainz succeeds,
    // even if only the MBID changed.
    if (
      !track.thumb &&
      !track.thumbUrl &&
      track.musicBrainzReleaseId
    ) {
      autoFetchAlbumArt(track);
    }

  } catch (err) {
    console.debug(
      `[Sleeve] MusicBrainz enrichment failed for "${track.title}":`,
      err?.message || err
    );
  }
}
  // ---------- Cover Art Archive album art auto-fetch ----------
  // Called after readTags / MusicBrainz enrichment when a track still has
  // no per-track thumbnail.  Uses the MusicBrainz recording search to find
  // a release MBID, then fetches the front cover from the Cover Art Archive.
  // Stores the result as the track's own thumbUrl so it shows up everywhere
  // thumbs already appear (cards, sidebar, now-playing, mini player).
// ---------- Album-level artwork auto-fetch ----------

const albumArtFetchAttempts = new Map();

function getAlbumArtworkKey(track) {
  const artist = normalizeMusicBrainzText(track?.artist || '');
  const album = normalizeMusicBrainzText(track?.album || '');

  if (!artist || !album) return null;

  return `${artist}\u241F${album}`;
}

async function applyArtworkToAlbum(track, blob) {
  if (!track || !blob) return false;

  const albumKey = getAlbumArtworkKey(track);

  if (!albumKey) return false;

  const tracksInAlbum = playlist.filter(other => {
    if (!other || other.kind === 'video') return false;

    return getAlbumArtworkKey(other) === albumKey;
  });

  if (!tracksInAlbum.length) {
    tracksInAlbum.push(track);
  }

  for (const albumTrack of tracksInAlbum) {
    try {
      if (albumTrack.thumbUrl) {
        try {
          URL.revokeObjectURL(albumTrack.thumbUrl);
        } catch (e) {}
      }

      albumTrack.thumb = blob;
      albumTrack.thumbUrl = URL.createObjectURL(blob);
      albumTrack.thumbKind = 'image';

      await dbPut(albumTrack);
    } catch (err) {
      console.debug(
        `[Sleeve] Failed applying album artwork to "${albumTrack.title}":`,
        err?.message || err
      );
    }
  }

  // Keep a persistent album-level copy too.
  try {
    await dbPutAlbumThumb(
      albumKey,
      blob,
      'image'
    );
  } catch (err) {
    console.debug(
      '[Sleeve] Failed saving album artwork:',
      err?.message || err
    );
  }

  scheduleRender(searchInput.value);

  if (
    currentIndex !== -1 &&
    playlist[currentIndex]?.id
  ) {
    updateNowPlayingArt(
      playlist[currentIndex]
    );
  }

  return true;
}

async function applyCachedAlbumArtwork(track) {
  const albumKey = getAlbumArtworkKey(track);

  if (!albumKey) return false;

  const cached = albumThumbs.get(albumKey);

  if (!cached?.blob) {
    return false;
  }

  return applyArtworkToAlbum(
    track,
    cached.blob
  );
}

async function saveAlbumArtworkFromUrl(track, artworkUrl) {
  if (!track || !artworkUrl) {
    return false;
  }

  try {
    const response = await fetch(
      artworkUrl,
      {
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      return false;
    }

    const blob = await response.blob();

    if (
      !blob ||
      !String(blob.type || '').startsWith('image/')
    ) {
      return false;
    }

    const thumbBlob = await makeThumbBlob(blob);

    if (!thumbBlob) {
      return false;
    }

    return applyArtworkToAlbum(
      track,
      thumbBlob
    );

  } catch (err) {
    console.debug(
      `[Sleeve] Album artwork download failed for "${track.album}":`,
      err?.message || err
    );

    return false;
  }
}

async function fetchCoverArtArchiveAlbumArtwork(track) {
  if (!track?.musicBrainzReleaseId) {
    return false;
  }

  try {
    const url =
      `https://coverartarchive.org/release/` +
      encodeURIComponent(
        track.musicBrainzReleaseId
      );

    const response = await fetch(
      url,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    if (!Array.isArray(data?.images)) {
      return false;
    }

    const front =
      data.images.find(image => image?.front) ||
      data.images[0];

    if (!front) {
      return false;
    }

    const artworkUrl =
      front?.thumbnails?.['500'] ||
      front?.thumbnails?.['1200'] ||
      front?.image ||
      null;

    if (!artworkUrl) {
      return false;
    }

    return saveAlbumArtworkFromUrl(
      track,
      artworkUrl
    );

  } catch (err) {
    console.debug(
      `[Sleeve] Cover Art Archive failed for album "${track.album}":`,
      err?.message || err
    );

    return false;
  }
}

async function autoFetchAlbumArt(track) {
  if (!track || track.kind === 'video') {
    return;
  }

  const artist = String(
    track.artist || ''
  ).trim();

  const album = String(
    track.album || ''
  ).trim();

  if (!artist || !album) {
    return;
  }

  const albumKey = getAlbumArtworkKey(track);

  if (!albumKey) {
    return;
  }

  // IMPORTANT:
  // Only perform one artwork lookup per album.
  if (albumArtFetchAttempts.get(albumKey)) {
    return;
  }

  // First check whether another song from this album
  // already has artwork.
  if (await applyCachedAlbumArtwork(track)) {
    albumArtFetchAttempts.set(
      albumKey,
      true
    );

    return;
  }

  albumArtFetchAttempts.set(
    albumKey,
    true
  );

  try {
    // If this particular track already knows its
    // MusicBrainz release, use it immediately.
    if (track.musicBrainzReleaseId) {
      const found =
        await fetchCoverArtArchiveAlbumArtwork(track);

      if (found) {
        console.debug(
          `[Sleeve] Album artwork found: ` +
          `${artist} - ${album}`
        );

        return;
      }
    }

    // Otherwise let MusicBrainz identify the album.
    await autoFetchMetadata(track);

    if (
      track.musicBrainzReleaseId &&
      !track.thumb &&
      !track.thumbUrl
    ) {
      const found =
        await fetchCoverArtArchiveAlbumArtwork(track);

      if (found) {
        console.debug(
          `[Sleeve] Album artwork found after MusicBrainz lookup: ` +
          `${artist} - ${album}`
        );

        return;
      }
    }

    // MusicBrainz didn't provide artwork.
    console.debug(
      `[Sleeve] No artwork found for album: ` +
      `${artist} - ${album}`
    );

  } catch (err) {
    console.debug(
      `[Sleeve] Album artwork lookup failed for ` +
      `${artist} - ${album}:`,
      err?.message || err
    );
  }
}



  // Reads native audio duration without a full decode; cheap probe used
  // to fill in run times on the detailed album page.
  const durationProbeCache = new Set();
  function probeDuration(track){
    if (track.duration != null || track.kind === 'video') return;
    if (durationProbeCache.has(track.id)) return;
    durationProbeCache.add(track.id);
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(probe.duration)){
        track.duration = probe.duration;
        dbPut(track);
        if (currentView.type === 'album') scheduleRender(searchInput.value);
      }
    }, { once: true });
    probe.addEventListener('error', () => {}, { once: true });
    probe.src = track.url;
  }

  // ---------- Song thumbnails ----------
  const thumbInput = document.getElementById('thumbInput');
  let thumbEditTrackId = null;

  function loadImageFromFile(file){
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function makeThumbBlob(file){
    if ((file.type && file.type.startsWith('video/')) || classifyFile(file) === 'video') return file;
    const img = await loadImageFromFile(file);
    const size = 300;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    URL.revokeObjectURL(img.src);
    return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.86));
  }

  function openThumbPicker(trackId){
    thumbEditTrackId = trackId;
    thumbInput.value = '';
    thumbInput.click();
  }

  thumbInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    const trackId = thumbEditTrackId;
    thumbEditTrackId = null;
    if (!file || trackId == null) return;
    const track = playlist.find(t => t.id === trackId);
    if (!track) return;
    try{
      const blob = await makeThumbBlob(file);
      if (track.thumbUrl){ try{ URL.revokeObjectURL(track.thumbUrl); }catch(err){} }
      track.thumb = blob;
      track.thumbUrl = URL.createObjectURL(blob);
      track.thumbKind = ((file.type && file.type.startsWith('video/')) || classifyFile(file) === 'video') ? 'video' : 'image';
      dbPut(track);
      if (currentIndex !== -1 && playlist[currentIndex].id === track.id) updateNowPlayingArt(track);
      scheduleRender(searchInput.value);
    }catch(err){ console.warn('Sleeve: could not set thumbnail', err); }
  });

  function clearTrackThumb(trackId){
    const track = playlist.find(t => t.id === trackId);
    if (!track) return;
    if (track.thumbUrl){ try{ URL.revokeObjectURL(track.thumbUrl); }catch(err){} }
    track.thumb = null;
    track.thumbUrl = null;
    track.thumbKind = null;
    if (currentIndex !== -1 && playlist[currentIndex].id === track.id) updateNowPlayingArt(track);
    dbPut(track);
    scheduleRender(searchInput.value);
  }


  // ---------- Manual metadata editor ----------
  const metadataEditorBackdrop = document.getElementById('metadataEditorBackdrop');
  const metadataEditorFile = document.getElementById('metadataEditorFile');
  const metadataArtist = document.getElementById('metadataArtist');
  const metadataAlbum = document.getElementById('metadataAlbum');
  const metadataGenre = document.getElementById('metadataGenre');
  const metadataYear = document.getElementById('metadataYear');
  const metadataCancelBtn = document.getElementById('metadataCancelBtn');
  const metadataSaveBtn = document.getElementById('metadataSaveBtn');
  let metadataEditTrackId = null;

  function openMetadataEditor(trackId){
    const track = playlist.find(t => t.id === trackId);
    if (!track) return;
    metadataEditTrackId = trackId;
    const manual = track.manualMetadata || {};
    metadataEditorFile.textContent = track.file ? track.file.name : track.title;
    metadataArtist.value = manual.artist ? track.artist || '' : (track.artist || '');
    metadataAlbum.value = manual.album ? track.album || '' : (track.album || '');
    metadataGenre.value = manual.genre ? track.genre || '' : (track.genre || '');
    metadataYear.value = manual.year ? track.year || '' : (track.year || '');
    metadataEditorBackdrop.classList.add('open');
    setTimeout(() => metadataArtist.focus(), 0);
  }

  function closeMetadataEditor(){
    metadataEditorBackdrop.classList.remove('open');
    metadataEditTrackId = null;
  }

  metadataCancelBtn.addEventListener('click', closeMetadataEditor);
  metadataEditorBackdrop.addEventListener('click', (e) => {
    if (e.target === metadataEditorBackdrop) closeMetadataEditor();
  });

  metadataSaveBtn.addEventListener('click', () => {
    const track = playlist.find(t => t.id === metadataEditTrackId);
    if (!track) return;

    const values = {
      artist: metadataArtist.value.trim(),
      album: metadataAlbum.value.trim(),
      genre: metadataGenre.value.trim(),
      year: metadataYear.value.trim()
    };

    if (values.year && !/^\d{4}$/.test(values.year)){
      alert('Year must be exactly four digits, such as 2026.');
      metadataYear.focus();
      return;
    }

    track.manualMetadata = track.manualMetadata || {};

    Object.keys(values).forEach(key => {
      if (values[key]){
        track[key] = values[key];
        track.manualMetadata[key] = true;
      } else {
        // Blank means: remove the manual override and try to restore the file tag.
        delete track.manualMetadata[key];
        track[key] = null;
      }
    });

    dbPut(track);
    closeMetadataEditor();
    scheduleRender(searchInput.value);
    // If a field was cleared, give the real file tag a chance to come back.
    if (!Object.keys(track.manualMetadata).length || Object.keys(values).some(k => !values[k])){
      readTags(track);
    }
  });

  [metadataArtist, metadataAlbum, metadataGenre, metadataYear].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') metadataSaveBtn.click();
      if (e.key === 'Escape') closeMetadataEditor();
    });
  });

  // ---------- Duplicate detection ----------
  // Groups tracks by normalised "artist · title" key.  Exact file duplicates
  // (same name, zero-byte difference) and fuzzy near-matches (same key after
  // stripping punctuation + casing) both count.
  function findDuplicates(){
    const groups = new Map();
    playlist.forEach(t => {
      if (t.kind === 'video') return;
      const artist = (t.artist || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const title  = (t.title  || '').trim().toLowerCase()
        .replace(/^\d{1,3}[\s.\-_]+/, '')    // strip leading track numbers
        .replace(/[^a-z0-9]/g, '');
      const key = artist + '\u241F' + title;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    });
    return Array.from(groups.values()).filter(g => g.length > 1);
  }

  function renderDuplicateBanner(){
    const existing = document.getElementById('dupeBanner');
    if (existing) existing.remove();

    const dupeGroups = findDuplicates();
    if (!dupeGroups.length) return;

    const total = dupeGroups.reduce((n, g) => n + g.length - 1, 0); // how many extras
    const banner = document.createElement('div');
    banner.id = 'dupeBanner';
    banner.className = 'dupe-banner';
    banner.innerHTML = `
      <span class="dupe-banner-icon">⚠</span>
      <span class="dupe-banner-text">${total} possible duplicate${total === 1 ? '' : 's'} found</span>
      <button class="dupe-banner-btn" type="button" id="dupeReviewBtn">Review</button>
      <button class="dupe-banner-dismiss" type="button" id="dupeDismissBtn" title="Dismiss">✕</button>
    `;
    // Insert above the card grid
    const mainContent = cardGrid?.parentElement;
    if (mainContent) mainContent.insertBefore(banner, cardGrid);

    document.getElementById('dupeReviewBtn').addEventListener('click', openDuplicateModal);
    document.getElementById('dupeDismissBtn').addEventListener('click', () => banner.remove());
  }

  function openDuplicateModal(){
    const dupeGroups = findDuplicates();
    if (!dupeGroups.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay dupe-modal-overlay';
    overlay.id = 'dupeModal';

    const box = document.createElement('div');
    box.className = 'modal-box dupe-modal-box';
    box.innerHTML = `
      <div class="dupe-modal-header">
        <h3>Duplicate tracks</h3>
        <button class="dupe-modal-close modal-btn" type="button" id="dupeModalClose">✕</button>
      </div>
      <p class="dupe-modal-sub">Keep the version you want and delete the rest. Sleeve won't delete anything until you confirm.</p>
      <div class="dupe-group-list" id="dupeGroupList"></div>
      <div class="modal-actions">
        <button class="modal-btn" type="button" id="dupeModalDone">Done</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const list = box.querySelector('#dupeGroupList');

    dupeGroups.forEach((group, gi) => {
      const section = document.createElement('div');
      section.className = 'dupe-group';

      const label = document.createElement('div');
      label.className = 'dupe-group-label';
      label.textContent = `Group ${gi + 1} — ${group.length} copies`;
      section.appendChild(label);

      group.forEach(t => {
        const row = document.createElement('div');
        row.className = 'dupe-row';
        const art = t.thumbUrl
          ? `<img src="${t.thumbUrl}" class="dupe-row-art" alt="">`
          : `<div class="dupe-row-art dupe-row-art-empty">♪</div>`;
        const meta = [t.artist, t.album, t.year].filter(Boolean).join(' · ') || 'No metadata';
        row.innerHTML = `
          ${art}
          <div class="dupe-row-meta">
            <div class="dupe-row-title">${escapeHtml(t.title)}</div>
            <div class="dupe-row-sub">${escapeHtml(meta)}</div>
          </div>
          <div class="dupe-row-actions">
            <button class="dupe-keep-btn modal-btn modal-btn-primary" type="button" data-track-id="${t.id}">Keep</button>
            <button class="dupe-delete-btn modal-btn" type="button" data-track-id="${t.id}">Delete</button>
          </div>
        `;
        section.appendChild(row);
      });

      list.appendChild(section);
    });

    function close(){
      overlay.remove();
      renderDuplicateBanner();
    }

    box.querySelector('#dupeModalClose').addEventListener('click', close);
    box.querySelector('#dupeModalDone').addEventListener('click', close);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });

    box.addEventListener('click', e => {
      const keepBtn   = e.target.closest('.dupe-keep-btn');
      const deleteBtn = e.target.closest('.dupe-delete-btn');
      if (!keepBtn && !deleteBtn) return;

      const trackId = parseInt((keepBtn || deleteBtn).dataset.trackId, 10);
      const track   = playlist.find(t => t.id === trackId);
      if (!track) return;

      if (deleteBtn){
        // Find which group this track belongs to, then delete it
        const group = findDuplicates().find(g => g.some(t => t.id === trackId));
        if (!group) return;
        // Remove the row from the modal immediately (no confirm since they're in the dupe UI)
        const row = deleteBtn.closest('.dupe-row');
        if (row) row.remove();
        // Actually delete the track
        const idx = playlist.findIndex(t => t.id === trackId);
        if (idx !== -1){
          const wasCurrent = idx === currentIndex;
          if (wasCurrent) stopEverything();
          try{ URL.revokeObjectURL(track.url); }catch(e){}
          playlist.splice(idx, 1);
          dbDeleteTrack(trackId);
          playlists.forEach(pl => {
            if (pl.trackIds.includes(trackId)){
              pl.trackIds = pl.trackIds.filter(id => id !== trackId);
              dbPutPlaylist(pl);
            }
          });
          if (wasCurrent){ currentIndex = -1; }
          else if (idx < currentIndex){ currentIndex -= 1; }
          scheduleRender(searchInput.value);
        }
        // Check if only one track remains in the group section — collapse the header
        const section = deleteBtn.closest('.dupe-group');
        if (section){
          const remaining = section.querySelectorAll('.dupe-row');
          if (remaining.length === 0) section.remove();
          else if (remaining.length === 1){
            const lbl = section.querySelector('.dupe-group-label');
            if (lbl) lbl.textContent = lbl.textContent.replace(/\d+ copies/, '1 copy — resolved');
          }
        }
      } else if (keepBtn){
        // "Keep" = delete all other tracks in this group
        const groups = findDuplicates();
        const group = groups.find(g => g.some(t => t.id === trackId));
        if (!group) return;
        group.forEach(t => {
          if (t.id === trackId) return; // keep this one
          const section = keepBtn.closest('.dupe-group');
          if (section){
            const rows = section.querySelectorAll('.dupe-row');
            rows.forEach(r => {
              const btn = r.querySelector('[data-track-id]');
              if (btn && parseInt(btn.dataset.trackId, 10) === t.id) r.remove();
            });
          }
          const idx = playlist.findIndex(tr => tr.id === t.id);
          if (idx === -1) return;
          const wasCurrent = idx === currentIndex;
          if (wasCurrent) stopEverything();
          try{ URL.revokeObjectURL(t.url); }catch(e){}
          playlist.splice(idx, 1);
          dbDeleteTrack(t.id);
          playlists.forEach(pl => {
            if (pl.trackIds.includes(t.id)){
              pl.trackIds = pl.trackIds.filter(id => id !== t.id);
              dbPutPlaylist(pl);
            }
          });
          if (wasCurrent){ currentIndex = -1; }
          else if (idx < currentIndex){ currentIndex -= 1; }
        });
        scheduleRender(searchInput.value);
        const section = keepBtn.closest('.dupe-group');
        if (section){
          const lbl = section.querySelector('.dupe-group-label');
          if (lbl) lbl.textContent = lbl.textContent.replace(/\d+ copies/, '1 copy — resolved');
        }
      }

      // If no duplicate groups remain, close the modal
      if (findDuplicates().length === 0) close();
    });
  }

  // Run duplicate check after library loads / after files are added.
  // Debounced so a batch import only triggers once.
  let dupeCheckTimer = null;
  function scheduleDupeCheck(){
    clearTimeout(dupeCheckTimer);
    dupeCheckTimer = setTimeout(() => {
      if (currentView.type === 'home') renderDuplicateBanner();
    }, 2000);
  }

  // ---------- Batch multi-select ----------
  // Tracks which track IDs are currently selected.
  // Shift-clicking a card/row or clicking the checkbox selects it.
  const selectedTrackIds = new Set();
  let lastSelectedIndex = -1;

  const selectionToolbar = document.getElementById('selectionToolbar');
  const selectionCount   = document.getElementById('selectionCount');
  const batchEditBtn     = document.getElementById('batchEditBtn');
  const batchDeleteBtn   = document.getElementById('batchDeleteBtn');
  const selectionClearBtn = document.getElementById('selectionClearBtn');

  function updateSelectionToolbar(){
    const n = selectedTrackIds.size;
    selectionToolbar.style.display = n > 0 ? 'flex' : 'none';
    selectionCount.textContent = `${n} selected`;
    // Highlight selected cards and list items
    document.querySelectorAll('.card[data-track-id], .track-item[data-track-id]').forEach(el => {
      const id = parseInt(el.dataset.trackId, 10);
      el.classList.toggle('batch-selected', selectedTrackIds.has(id));
    });
  }

  function clearSelection(){
    selectedTrackIds.clear();
    lastSelectedIndex = -1;
    updateSelectionToolbar();
  }

  function toggleTrackSelected(trackId, shiftHeld, clickedVisibleIndex, visibleIds){
    if (shiftHeld && lastSelectedIndex !== -1 && visibleIds){
      const from = Math.min(lastSelectedIndex, clickedVisibleIndex);
      const to   = Math.max(lastSelectedIndex, clickedVisibleIndex);
      for (let i = from; i <= to; i++){
        if (visibleIds[i] != null) selectedTrackIds.add(visibleIds[i]);
      }
    } else {
      if (selectedTrackIds.has(trackId)) selectedTrackIds.delete(trackId);
      else selectedTrackIds.add(trackId);
    }
    lastSelectedIndex = clickedVisibleIndex;
    updateSelectionToolbar();
  }

  selectionClearBtn?.addEventListener('click', clearSelection);

  batchDeleteBtn?.addEventListener('click', () => {
    if (!selectedTrackIds.size) return;
    if (!confirm(`Delete ${selectedTrackIds.size} selected track${selectedTrackIds.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const ids = Array.from(selectedTrackIds);
    ids.forEach(id => {
      const idx = playlist.findIndex(t => t.id === id);
      if (idx === -1) return;
      const track = playlist[idx];
      const wasCurrent = idx === currentIndex;
      if (wasCurrent) stopEverything();
      try{ URL.revokeObjectURL(track.url); }catch(e){}
      playlist.splice(idx, 1);
      dbDeleteTrack(id);
      playlists.forEach(pl => {
        if (pl.trackIds.includes(id)){
          pl.trackIds = pl.trackIds.filter(tid => tid !== id);
          dbPutPlaylist(pl);
        }
      });
      if (wasCurrent) currentIndex = -1;
      else if (idx < currentIndex) currentIndex -= 1;
    });
    clearSelection();
    scheduleRender(searchInput.value);
  });

  batchEditBtn?.addEventListener('click', openBatchMetadataEditor);

  // ---------- Batch metadata editor ----------
  const batchMetadataBackdrop = document.getElementById('batchMetadataBackdrop');
  const batchMetadataCount    = document.getElementById('batchMetadataCount');
  const batchArtist  = document.getElementById('batchArtist');
  const batchAlbum   = document.getElementById('batchAlbum');
  const batchGenre   = document.getElementById('batchGenre');
  const batchYear    = document.getElementById('batchYear');

  function openBatchMetadataEditor(){
    if (!selectedTrackIds.size) return;
    batchMetadataCount.textContent = selectedTrackIds.size;
    batchArtist.value = '';
    batchAlbum.value  = '';
    batchGenre.value  = '';
    batchYear.value   = '';
    batchMetadataBackdrop.style.display = 'flex';
    setTimeout(() => batchArtist.focus(), 0);
  }

  function closeBatchMetadataEditor(){
    batchMetadataBackdrop.style.display = 'none';
  }

  document.getElementById('batchMetadataCancelBtn')?.addEventListener('click', closeBatchMetadataEditor);
  batchMetadataBackdrop?.addEventListener('click', e => {
    if (e.target === batchMetadataBackdrop) closeBatchMetadataEditor();
  });

  document.getElementById('batchMetadataSaveBtn')?.addEventListener('click', () => {
    const year = batchYear.value.trim();
    if (year && !/^\d{4}$/.test(year)){
      alert('Year must be exactly four digits, such as 2026.');
      batchYear.focus();
      return;
    }
    const values = {
      artist: batchArtist.value.trim(),
      album:  batchAlbum.value.trim(),
      genre:  batchGenre.value.trim(),
      year:   year
    };
    const hasAnyValue = Object.values(values).some(v => v);
    if (!hasAnyValue){ closeBatchMetadataEditor(); return; }

    selectedTrackIds.forEach(id => {
      const track = playlist.find(t => t.id === id);
      if (!track) return;
      track.manualMetadata = track.manualMetadata || {};
      Object.keys(values).forEach(key => {
        if (values[key]){
          track[key] = values[key];
          track.manualMetadata[key] = true;
        }
      });
      dbPut(track);
    });

    closeBatchMetadataEditor();
    clearSelection();
    scheduleRender(searchInput.value);
    if (currentIndex !== -1 && selectedTrackIds.has(playlist[currentIndex]?.id)){
      updateNowPlayingText(playlist[currentIndex], currentIndex);
    }
  });

  [batchArtist, batchAlbum, batchGenre, batchYear].forEach(input => {
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter')  document.getElementById('batchMetadataSaveBtn').click();
      if (e.key === 'Escape') closeBatchMetadataEditor();
    });
  });

  // ---------- Album thumbnails ----------
  const albumThumbInput = document.getElementById('albumThumbInput');
  let albumThumbEditKey = null;

  function openAlbumThumbPicker(key){
    albumThumbEditKey = key;
    albumThumbInput.value = '';
    albumThumbInput.click();
  }

  albumThumbInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    const key = albumThumbEditKey;
    albumThumbEditKey = null;
    if (!file || !key) return;
    try{
      const blob = await makeThumbBlob(file);
      const existing = albumThumbs.get(key);
      if (existing && existing.url){ try{ URL.revokeObjectURL(existing.url); }catch(err){} }
      const kind = ((file.type && file.type.startsWith('video/')) || classifyFile(file) === 'video') ? 'video' : 'image';
      albumThumbs.set(key, { blob, url: URL.createObjectURL(blob), kind });
      dbPutAlbumThumb(key, blob, kind);
      scheduleRender(searchInput.value);
    }catch(err){ console.warn('Sleeve: could not set album thumbnail', err); }
  });

  function clearAlbumThumb(key){
    const existing = albumThumbs.get(key);
    if (existing && existing.url){ try{ URL.revokeObjectURL(existing.url); }catch(err){} }
    albumThumbs.delete(key);
    dbDeleteAlbumThumb(key);
    scheduleRender(searchInput.value);
  }

  function albumArtMarkup(entry, alt){
    if (!entry) return NOTE_ICON;
    return entry.kind === 'video'
      ? `<video src="${entry.url}" muted loop autoplay playsinline aria-label="${escapeHtml(alt || '')}"></video>`
      : `<img src="${entry.url}" alt="${escapeHtml(alt || '')}">`;
  }

  // ---------- Artist thumbnails ----------
  const artistThumbInput = document.getElementById('artistThumbInput');
  let artistThumbEditKey = null;

  function openArtistThumbPicker(artistName){
    artistThumbEditKey = artistName;
    artistThumbInput.value = '';
    artistThumbInput.click();
  }

  artistThumbInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    const key = artistThumbEditKey;
    artistThumbEditKey = null;
    if (!file || !key) return;
    try{
      const blob = await makeThumbBlob(file);
      const existing = artistThumbs.get(key);
      if (existing && existing.url){ try{ URL.revokeObjectURL(existing.url); }catch(err){} }
      artistThumbs.set(key, { blob, url: URL.createObjectURL(blob) });
      dbPutArtistThumb(key, blob);
      scheduleRender(searchInput.value);
    }catch(err){ console.warn('Sleeve: could not set artist thumbnail', err); }
  });

  function clearArtistThumb(key){
    const existing = artistThumbs.get(key);
    if (existing && existing.url){ try{ URL.revokeObjectURL(existing.url); }catch(err){} }
    artistThumbs.delete(key);
    dbDeleteArtistThumb(key);
    scheduleRender(searchInput.value);
  }

  // ---------- Artist/album grouping ----------
  function getArtists(){
    const map = new Map();
    playlist.forEach(t => {
      if (t.kind === 'video') return;
      const artist = (t.artist || '').trim() || 'Unknown Artist';
      if (!map.has(artist)) map.set(artist, []);
      map.get(artist).push(t);
    });
    return Array.from(map.entries())
      .map(([name, tracks]) => ({ name, tracks }))
      .sort((a, b) => {
        if (a.name === 'Unknown Artist') return 1;
        if (b.name === 'Unknown Artist') return -1;
        return a.name.localeCompare(b.name);
      });
  }

  function getAlbumsForArtist(artistName){
    const map = new Map();
    playlist.forEach(t => {
      if (t.kind === 'video') return;
      const artist = (t.artist || '').trim() || 'Unknown Artist';
      if (artist !== artistName) return;
      const album = (t.album || '').trim() || 'Unknown Album';
      if (!map.has(album)) map.set(album, []);
      map.get(album).push(t);
    });
    return Array.from(map.entries())
      .map(([name, tracks]) => ({ name, tracks }))
      .sort((a, b) => {
        if (a.name === 'Unknown Album') return 1;
        if (b.name === 'Unknown Album') return -1;
        return a.name.localeCompare(b.name);
      });
  }

  function getYears(){
    const map = new Map();
    playlist.forEach(t => {
      if (t.kind === 'video') return;
      const year = (t.year || '').toString().trim() || 'Unknown Year';
      if (!map.has(year)) map.set(year, []);
      map.get(year).push(t);
    });
    return Array.from(map.entries())
      .map(([name, tracks]) => ({ name, tracks }))
      .sort((a, b) => {
        if (a.name === 'Unknown Year') return 1;
        if (b.name === 'Unknown Year') return -1;
        return Number(b.name) - Number(a.name); // youngest (newest) down to oldest
      });
  }

  function getGenres(){
    const map = new Map();
    playlist.forEach(t => {
      if (t.kind === 'video') return;
      const genre = (t.genre || '').trim() || 'Unknown Genre';
      if (!map.has(genre)) map.set(genre, []);
      map.get(genre).push(t);
    });
    return Array.from(map.entries())
      .map(([name, tracks]) => ({ name, tracks }))
      .sort((a, b) => {
        if (a.name === 'Unknown Genre') return 1;
        if (b.name === 'Unknown Genre') return -1;
        return a.name.localeCompare(b.name);
      });
  }

  // Returns the album's thumbnail entry ({ blob, url, kind }) for this track
  // when the "Use album art as track thumbnail" setting is on, its own
  // explicit thumbnail is unset, and an album thumbnail actually exists.
  function albumArtForTrack(track){
    if (!settings.albumArtAsTrackThumb) return null;
    if (!track || track.kind === 'video' || track.thumbUrl) return null;
    const artist = (track.artist || '').trim() || 'Unknown Artist';
    const album = (track.album || '').trim() || 'Unknown Album';
    return albumThumbs.get(albumKey(artist, album)) || null;
  }

  function renderAlbumDetail(artistName, albumName, visible){
    const key = albumKey(artistName, albumName);
    const art = albumThumbs.get(key);
    const albumTracks = playlist
      .filter(t => t.kind !== 'video' && (t.artist || 'Unknown Artist') === artistName && (t.album || 'Unknown Album') === albumName)
      .sort((a, b) => settings.albumTrackOrder
        ? (a.trackNum || Number.MAX_SAFE_INTEGER) - (b.trackNum || Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)
        : playlist.indexOf(a) - playlist.indexOf(b));
    const visibleTracks = visible
      .map(({ t }) => t)
      .sort((a, b) => albumTracks.indexOf(a) - albumTracks.indexOf(b));
    const totalDuration = albumTracks.reduce((sum, track) => sum + (track.duration || 0), 0);
    const years = albumTracks.map(track => track.year).filter(Boolean);
    const genres = albumTracks.map(track => track.genre).filter(Boolean);
    const meta = [years[0] || '', genres[0] || '', `${albumTracks.length} track${albumTracks.length === 1 ? '' : 's'}`, totalDuration ? formatTime(totalDuration) : 'Runtime pending']
      .filter(Boolean).join('  •  ');
    const artInner = albumArtMarkup(art, albumName);

    albumTracks.forEach(track => probeDuration(track));
    albumDetail.innerHTML = `
      <section class="album-detail-hero">
        <button class="album-detail-art" type="button" title="Set album thumbnail">${artInner}</button>
        <div class="album-detail-info">
          <div class="album-detail-title">${escapeHtml(albumName)}</div>
          <button class="album-detail-artist" type="button">${escapeHtml(artistName)}</button>
          <div class="album-detail-metaline">${escapeHtml(meta)}</div>
          <div class="album-detail-actions">
            <button class="album-detail-play" type="button"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play</button>
            <button class="album-detail-shuffle" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg> Shuffle</button>
          </div>
        </div>
      </section>
      <section class="album-track-table" aria-label="Tracks">
        <div class="album-track-header"><span>#</span><span>Title</span><span>Artist</span><span>Year</span><span>Genre</span><span>Time</span></div>
        ${visibleTracks.map(t => {
          const number = t.trackNum || albumTracks.indexOf(t) + 1;
          return `<div class="album-track-row${playlist.indexOf(t) === currentIndex ? ' active' : ''}" data-track-id="${t.id}">
            <span class="album-track-num">${number}</span>
            <span class="album-track-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
            <span class="album-track-artist">${escapeHtml(t.artist || artistName)}</span>
            <span class="album-track-year">${escapeHtml(t.year || '—')}</span>
            <span class="album-track-genre">${escapeHtml(t.genre || '—')}</span>
            <span class="album-track-duration">${t.duration ? formatTime(t.duration) : '--:--'}</span>
          </div>`;
        }).join('')}
      </section>`;

    albumDetail.querySelector('.album-detail-art').addEventListener('click', () => openAlbumThumbPicker(key));
    albumDetail.querySelector('.album-detail-artist').addEventListener('click', () => {
      currentView = { type: 'artistAlbums', artist: artistName };
      scheduleRender(searchInput.value);
    });
    albumDetail.querySelector('.album-detail-play').addEventListener('click', () => {
      activeQueueIds = albumTracks.map(track => track.id);
      if (albumTracks.length) playTrackAt(playlist.indexOf(albumTracks[0]), true);
    });
    albumDetail.querySelector('.album-detail-shuffle').addEventListener('click', () => {
      activeQueueIds = albumTracks.map(track => track.id);
      for (let i = activeQueueIds.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [activeQueueIds[i], activeQueueIds[j]] = [activeQueueIds[j], activeQueueIds[i]];
      }
      if (activeQueueIds.length) playTrackAt(playlist.findIndex(track => track.id === activeQueueIds[0]), true);
    });
    albumDetail.querySelectorAll('.album-track-row').forEach(row => row.addEventListener('click', () => {
      activeQueueIds = albumTracks.map(track => track.id);
      playTrackAt(playlist.findIndex(track => track.id === Number(row.dataset.trackId)), true);
    }));
  }

  fileInput.addEventListener('change', (e) => {
    addFiles(e.target.files);
    fileInput.value = '';
  });

  // ---------- Drag & drop files anywhere onto the app ----------
  const dropOverlay = document.getElementById('dropOverlay');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    dropOverlay.classList.add('active');
  });
  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.classList.remove('active');
  });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('active');
    addFiles(e.dataTransfer.files);
  });

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---------- Lyrics ----------
  const lyricsToggleBtn = document.getElementById('lyricsToggleBtn');
  const lyricsPanel = document.getElementById('lyricsPanel');
  const lyricsPanelLines = document.getElementById('lyricsPanelLines');
  let lyricsFetchAttempts = new Map(); // Track which tracks we've already tried to fetch for

  const lyricsModalOverlay = document.getElementById('lyricsModalOverlay');
  const lyricsModal = document.getElementById('lyricsModal');
  const lyricsModalClose = document.getElementById('lyricsModalClose');
  const lyricsModalTrackName = document.getElementById('lyricsModalTrackName');
  const lyricsTextarea = document.getElementById('lyricsTextarea');
  const lyricsEditPane = document.getElementById('lyricsEditPane');
  const lyricsSyncPane = document.getElementById('lyricsSyncPane');
  const lyricsSaveBtn = document.getElementById('lyricsSaveBtn');
  const lyricsClearBtn = document.getElementById('lyricsClearBtn');
  const lyricsSyncPlayBtn = document.getElementById('lyricsSyncPlayBtn');
  const lyricsSyncPlayIcon = document.getElementById('lyricsSyncPlayIcon');
  const lyricsSyncTime = document.getElementById('lyricsSyncTime');
  const lyricsTagBtn = document.getElementById('lyricsTagBtn');
  const lyricsSyncRestart = document.getElementById('lyricsSyncRestart');
  const lyricsSyncList = document.getElementById('lyricsSyncList');

  let lyricsEditTrackId = null;
  let lyricsPanelOpen = false;
  let syncLines = []; // [{ text, time: null|number }]
  let syncCursor = 0;
  let currentLyricsParsed = null;
  let currentActiveLine = -1;

  const LYRIC_TIME_TAG_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

   // Auto-fetch lyrics from LRCLIB if not already cached.
// Prefers synced LRC lyrics, then falls back to plain lyrics.
async function autoFetchLyrics(track) {
  if (!track || track.lyrics) return;
  if (lyricsFetchAttempts.get(track.id)) return;

  const artist = String(track.artist || '').trim();
  const originalTitle = String(track.title || '').trim();
  const album = String(track.album || '').trim();

  if (!artist || !originalTitle) {
    console.debug('Lyrics auto-fetch skipped: missing artist or title');
    return;
  }

 
const cleanedTitle = originalTitle
  // Remove year at the beginning:
  // "(2004) 02 69 Tea" -> "02 69 Tea"
  .replace(/^\s*\(\s*(?:19|20)\d{2}\s*\)\s*/i, '')

  // Remove track number at the beginning:
  // "02 69 Tea" -> "69 Tea"
  // "02. 69 Tea" -> "69 Tea"
  // "02 - 69 Tea" -> "69 Tea"
  .replace(/^\s*\d{1,3}\s*[-–—.)_:]+\s*/i, '')
  .replace(/^\s*\d{1,3}\s+/i, '')

  // Remove year at the end:
  // "69 Tea (2004)" -> "69 Tea"
  .replace(/\s*\(\s*(?:19|20)\d{2}\s*\)\s*$/i, '')

  // Remove clean tags:
  // "69 Tea (Clean)" -> "69 Tea"
  .replace(/\s*[\[(]\s*clean(?:\s+version)?\s*[\])]\s*$/i, '')

  .trim();

const titleVariants = [...new Set([
  originalTitle,
  cleanedTitle
].filter(Boolean))];

  // Only mark this track as attempted once we have
  // enough information to actually perform a lookup.
  lyricsFetchAttempts.set(track.id, true);

  console.debug('Lyrics auto-fetch:', {
    artist,
    originalTitle,
    titleVariants,
    album,
    duration: track.duration
  });

  for (const title of titleVariants) {
    try {
      const params = new URLSearchParams({
        track_name: title,
        artist_name: artist
      });

      if (album) {
        params.set('album_name', album);
      }

      // LRCLIB expects duration in seconds.
      // Only include it if the track has a sensible numeric duration.
      const duration = Number(track.duration);

      if (Number.isFinite(duration) && duration > 0) {
        params.set('duration', String(Math.round(duration)));
      }

      const url = `https://lrclib.net/api/get?${params.toString()}`;

      console.debug('Lyrics lookup:', url);

      const response = await fetch(url, {
        signal: AbortSignal.timeout(7000),
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        console.debug(
          `Lyrics lookup failed for "${title}": HTTP ${response.status}`
        );
        continue;
      }

      const data = await response.json();

      if (!data) {
        console.debug(
          `Lyrics lookup returned no data for "${title}"`
        );
        continue;
      }

      // Prefer synchronized lyrics because your existing
      // parseLyrics() already understands LRC timestamps.
      const syncedLyrics =
        typeof data.syncedLyrics === 'string'
          ? data.syncedLyrics.trim()
          : '';

      const plainLyrics =
        typeof data.plainLyrics === 'string'
          ? data.plainLyrics.trim()
          : '';

      const lyricsToSave = syncedLyrics || plainLyrics;

      if (!lyricsToSave) {
        console.debug(
          `Lyrics lookup returned no usable lyrics for "${title}"`
        );
        continue;
      }

      // Store the fetched lyrics on the existing track object.
      // We do NOT modify the IndexedDB structure.
      track.lyrics = lyricsToSave;

      // Use Sleeve's existing persistence system.
      // queueTrackWrite() already stores track.lyrics.
      await dbPut(track);

      console.debug(
        `Lyrics found for "${artist} - ${title}"` +
        `${syncedLyrics ? ' (synced LRC)' : ' (plain lyrics)'}` +
        ' and queued for saving.'
      );

      // Refresh the lyrics panel if this is still
      // the currently playing track.
      if (
        currentIndex !== -1 &&
        playlist[currentIndex] &&
        playlist[currentIndex].id === track.id
      ) {
        renderLyricsPanel();
      }

      return;
    } catch (err) {
      console.debug(
        `Lyrics lookup error for "${title}":`,
        err?.message || err
      );
    }
  }

  console.debug(
    `No lyrics found for "${artist} - ${originalTitle}"`
  );
}

  function parseLyrics(raw){
    if (!raw) return { timed: false, lines: [] };
    const rawLines = raw.split(/\r?\n/);
    const parsed = [];
    let anyTimed = false;
    for (const line of rawLines){
      const tags = [...line.matchAll(LYRIC_TIME_TAG_RE)];
      const text = line.replace(LYRIC_TIME_TAG_RE, '').trim();
      if (tags.length > 0){
        anyTimed = true;
        tags.forEach(tag => {
          const min = parseInt(tag[1], 10);
          const sec = parseInt(tag[2], 10);
          const frac = tag[3] ? parseFloat('0.' + tag[3].padEnd(3, '0').slice(0, 3)) : 0;
          parsed.push({ time: min * 60 + sec + frac, text });
        });
      } else if (text){
        parsed.push({ time: null, text });
      }
    }
    if (anyTimed){
      return { timed: true, lines: parsed.filter(p => p.time !== null).sort((a, b) => a.time - b.time) };
    }
    return { timed: false, lines: parsed.filter(p => p.text) };
  }

  function formatLrcTime(t){
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, '0');
    return `${String(m).padStart(2, '0')}:${s}`;
  }

  function findActiveLyricIndex(lines, t){
    let idx = -1;
    for (let i = 0; i < lines.length; i++){
      if (lines[i].time <= t) idx = i; else break;
    }
    return idx;
  }

  function updateLyricsToggleVisibility(){
    const track = currentIndex !== -1 ? playlist[currentIndex] : null;
    lyricsToggleBtn.style.display = track ? 'inline-block' : 'none';
    if (!track){
      lyricsPanelOpen = false;
      lyricsPanel.classList.remove('open');
      lyricsToggleBtn.classList.remove('active');
    }
  }

  function renderLyricsPanel(){
    const track = currentIndex !== -1 ? playlist[currentIndex] : null;
    currentActiveLine = -1;
    if (!track || !track.lyrics){
      currentLyricsParsed = null;
      lyricsPanelLines.innerHTML = `<div class="lyrics-empty">No lyrics yet for this song. <a id="lyricsEmptyAddLink">Add lyrics</a></div>`;
      const link = document.getElementById('lyricsEmptyAddLink');
      if (link && track) link.addEventListener('click', () => openLyricsEditor(track.id));
      return;
    }
    const parsed = parseLyrics(track.lyrics);
    currentLyricsParsed = parsed;
    if (parsed.lines.length === 0){
      lyricsPanelLines.innerHTML = `<div class="lyrics-empty">No lyrics yet for this song. <a id="lyricsEmptyAddLink">Add lyrics</a></div>`;
      const link = document.getElementById('lyricsEmptyAddLink');
      if (link) link.addEventListener('click', () => openLyricsEditor(track.id));
      return;
    }
    lyricsPanelLines.innerHTML = parsed.lines.map((l, i) => `<div class="lyrics-line" data-i="${i}">${escapeHtml(l.text)}</div>`).join('');
    updateLyricsHighlight(getCurrentTime());
  }

  function updateLyricsHighlight(t){
    if (!lyricsPanelOpen || !currentLyricsParsed || !currentLyricsParsed.timed) return;
    const idx = findActiveLyricIndex(currentLyricsParsed.lines, t);
    if (idx === currentActiveLine) return;
    currentActiveLine = idx;
    const lineEls = lyricsPanelLines.querySelectorAll('.lyrics-line');
    lineEls.forEach(el => el.classList.remove('active'));
    if (idx >= 0 && lineEls[idx]){
      lineEls[idx].classList.add('active');
      lineEls[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  lyricsToggleBtn.addEventListener('click', () => {
    lyricsPanelOpen = !lyricsPanelOpen;
    lyricsPanel.classList.toggle('open', lyricsPanelOpen);
    lyricsToggleBtn.classList.toggle('active', lyricsPanelOpen);
    if (lyricsPanelOpen) renderLyricsPanel();
  });

  // ---------- Lyrics editor modal ----------
  function openLyricsEditor(trackId){
    const track = playlist.find(t => t.id === trackId);
    if (!track) return;
    lyricsEditTrackId = trackId;
    lyricsModalTrackName.textContent = track.title;
    lyricsTextarea.value = track.lyrics || '';
    switchLyricsTab('edit');
    lyricsModalOverlay.classList.add('open');
    lyricsModal.classList.add('open');
    setTimeout(() => lyricsTextarea.focus(), 50);
  }

  function closeLyricsEditor(){
    lyricsModalOverlay.classList.remove('open');
    lyricsModal.classList.remove('open');
    lyricsEditTrackId = null;
  }

  lyricsModalClose.addEventListener('click', closeLyricsEditor);
  lyricsModalOverlay.addEventListener('click', closeLyricsEditor);

  function switchLyricsTab(tabName){
    document.querySelectorAll('.lyrics-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    lyricsEditPane.style.display = tabName === 'edit' ? 'block' : 'none';
    lyricsSyncPane.style.display = tabName === 'sync' ? 'block' : 'none';
    if (tabName === 'sync'){
      if (lyricsEditTrackId != null && (currentIndex === -1 || playlist[currentIndex].id !== lyricsEditTrackId)){
        const idx = playlist.findIndex(t => t.id === lyricsEditTrackId);
        if (idx !== -1) loadTrack(idx, false);
      }
      buildSyncList();
    }
  }
  document.querySelectorAll('.lyrics-tab').forEach(btn => {
    btn.addEventListener('click', () => switchLyricsTab(btn.dataset.tab));
  });

  function buildSyncList(){
    const raw = lyricsTextarea.value;
    syncLines = raw.split(/\r?\n/)
      .map(line => line.replace(LYRIC_TIME_TAG_RE, '').trim())
      .filter(text => text.length > 0)
      .map(text => ({ text, time: null }));
    syncCursor = 0;
    renderSyncList();
  }

  function renderSyncList(){
    lyricsSyncList.innerHTML = syncLines.map((l, i) => `
      <div class="lyrics-sync-line${l.time != null ? ' tagged' : ''}${i === syncCursor ? ' current' : ''}" data-i="${i}">
        <span class="lyrics-sync-line-time">${l.time != null ? formatTime(l.time) : '--:--'}</span>
        <span class="lyrics-sync-line-text">${escapeHtml(l.text)}</span>
      </div>
    `).join('');
    const currentEl = lyricsSyncList.querySelector('.lyrics-sync-line.current');
    if (currentEl) currentEl.scrollIntoView({ block: 'nearest' });
  }

  function tagCurrentLine(){
    if (syncCursor >= syncLines.length) return;
    syncLines[syncCursor].time = getCurrentTime();
    syncCursor++;
    renderSyncList();
    if (syncCursor >= syncLines.length) commitSyncToTextarea();
  }

  function commitSyncToTextarea(){
    lyricsTextarea.value = syncLines.map(l => `[${l.time != null ? formatLrcTime(l.time) : '00:00.00'}]${l.text}`).join('\n');
  }

  lyricsTagBtn.addEventListener('click', tagCurrentLine);
  lyricsSyncRestart.addEventListener('click', () => {
    syncLines.forEach(l => { l.time = null; });
    syncCursor = 0;
    renderSyncList();
  });
  lyricsSyncPlayBtn.addEventListener('click', () => playBtn.click());

  lyricsSaveBtn.addEventListener('click', () => {
    if (lyricsEditTrackId == null) return;
    const track = playlist.find(t => t.id === lyricsEditTrackId);
    if (!track) return;
    track.lyrics = lyricsTextarea.value.trim() || null;
    dbPut(track);
    if (currentIndex !== -1 && playlist[currentIndex].id === track.id && lyricsPanelOpen) renderLyricsPanel();
    scheduleRender(searchInput.value);
    closeLyricsEditor();
  });

  lyricsClearBtn.addEventListener('click', () => {
    if (lyricsEditTrackId == null) return;
    const track = playlist.find(t => t.id === lyricsEditTrackId);
    if (!track) return;
    if (track.lyrics && !confirm('Clear lyrics for this song?')) return;
    track.lyrics = null;
    dbPut(track);
    lyricsTextarea.value = '';
    if (currentIndex !== -1 && playlist[currentIndex].id === track.id && lyricsPanelOpen) renderLyricsPanel();
    scheduleRender(searchInput.value);
  });

  // ---------- Drag-to-reorder within a playlist (pointer events: works for mouse + touch) ----------
  function setupReorderHandle(handle, el, container, mode, trackId, activePlaylist){
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const pointerId = e.pointerId;
      try{ handle.setPointerCapture(pointerId); }catch(err){}
      el.classList.add('dragging');

      let indicator = null;
      if (mode === 'list'){
        indicator = document.createElement('div');
        indicator.className = 'reorder-line';
        container.appendChild(indicator);
      }

      let currentTarget = null;
      let currentPos = null; // 'top' | 'bottom', list mode only
      let moved = false;
      let rafId = null;
      let lastEvent = null;

      function clearHighlights(){
        container.querySelectorAll('.drag-over').forEach(n => n.classList.remove('drag-over'));
        if (indicator) indicator.classList.remove('visible');
      }

      function positionIndicator(itemEl, pos){
        if (!indicator) return;
        const containerRect = container.getBoundingClientRect();
        const itemRect = itemEl.getBoundingClientRect();
        const y = (pos === 'top' ? itemRect.top : itemRect.bottom) - containerRect.top + container.scrollTop;
        indicator.style.transform = `translateY(${y}px)`;
        indicator.classList.add('visible');
      }

      function itemFromPoint(x, y){
        const under = document.elementFromPoint(x, y);
        if (!under) return null;
        const sel = mode === 'list' ? '.track-item' : '.card';
        const found = under.closest(sel);
        return (found && container.contains(found)) ? found : null;
      }

      function processMove(ev){
        const itemEl = itemFromPoint(ev.clientX, ev.clientY);
        if (itemEl && itemEl !== el){
          currentTarget = itemEl;
          if (mode === 'list'){
            const rect = itemEl.getBoundingClientRect();
            const isTop = ev.clientY < rect.top + rect.height / 2;
            currentPos = isTop ? 'top' : 'bottom';
            positionIndicator(itemEl, currentPos);
          } else {
            container.querySelectorAll('.drag-over').forEach(n => { if (n !== itemEl) n.classList.remove('drag-over'); });
            itemEl.classList.add('drag-over');
          }
        } else {
          currentTarget = null;
          clearHighlights();
        }
      }

      function onMove(ev){
        moved = true;
        lastEvent = ev;
        if (rafId === null){
          rafId = requestAnimationFrame(() => {
            rafId = null;
            if (lastEvent) processMove(lastEvent);
          });
        }
      }

      function onUp(){
        try{ handle.releasePointerCapture(pointerId); }catch(err){}
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onCancel);
        if (rafId !== null) cancelAnimationFrame(rafId);
        el.classList.remove('dragging');
        clearHighlights();
        if (indicator) indicator.remove();

        if (moved && currentTarget){
          const toId = parseInt(currentTarget.dataset.trackId, 10);
          if (toId !== trackId){
            const pl = activePlaylist;
            const fromIdx = pl.trackIds.indexOf(trackId);
            let toIdx = pl.trackIds.indexOf(toId);
            if (fromIdx !== -1 && toIdx !== -1){
              pl.trackIds.splice(fromIdx, 1);
              toIdx = pl.trackIds.indexOf(toId);
              let insertAt = toIdx;
              if (mode === 'list' && currentPos === 'bottom') insertAt = toIdx + 1;
              pl.trackIds.splice(insertAt, 0, trackId);
              dbPutPlaylist(pl);
              if (activeQueueIds) activeQueueIds = pl.trackIds.slice();
              scheduleRender(searchInput.value);
            }
          }
        }
      }
      function onCancel(){ onUp(); }

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
    });
  }

  function deleteTrack(id){
    const index = playlist.findIndex(t => t.id === id);
    if (index === -1) return;
    const track = playlist[index];
    if (!confirm(`Delete "${track.title}" from your library? This cannot be undone.`)) return;

    const wasCurrent = index === currentIndex;
    if (wasCurrent) stopEverything();
    if (lyricsEditTrackId === id) closeLyricsEditor();

    try{ URL.revokeObjectURL(track.url); }catch(e){}
    playlist.splice(index, 1);
    dbDeleteTrack(id);

    playlists.forEach(pl => {
      if (pl.trackIds.includes(id)){
        pl.trackIds = pl.trackIds.filter(tid => tid !== id);
        dbPutPlaylist(pl);
      }
    });

    if (wasCurrent || playlist.length === 0){
      currentIndex = -1;
      npTitle.textContent = 'Nothing playing';
      npSub.textContent = '—';
      stageTitle.textContent = 'Nothing playing';
      stageSub.textContent = 'Pick a track from your shelf below';
      stageBadge.style.display = 'none';
      stageVisual.classList.remove('has-video');
      updateNowPlayingArt(null);
      stagePanel.classList.remove('has-video');
      mediaEl.controls = false;
      videoPipBtn.style.display = 'none';
      updateLyricsToggleVisibility();
      if (lyricsPanelOpen) renderLyricsPanel();
    } else if (index < currentIndex){
      currentIndex -= 1;
    }

    scheduleRender(searchInput.value);
  }

  function renameTrack(id, newTitle){
    const track = playlist.find(t => t.id === id);
    if (!track) return;
    const trimmed = (newTitle || '').trim();
    if (!trimmed || trimmed === track.title) return;
    track.title = trimmed;
    dbPut(track);
    if (currentIndex !== -1 && playlist[currentIndex].id === id){
      updateNowPlayingText(track, currentIndex);
    }
    scheduleRender(searchInput.value);
  }

  function startInlineRename(titleEl, track){
    if (titleEl.querySelector('input')) return;
    const original = track.title;
    titleEl.textContent = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = original;
    input.maxLength = 200;
    titleEl.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    function commit(){
      if (settled) return;
      settled = true;
      renameTrack(track.id, input.value);
    }
    function cancel(){
      if (settled) return;
      settled = true;
      scheduleRender(searchInput.value);
    }
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter'){ e.preventDefault(); input.blur(); commit(); }
      else if (e.key === 'Escape'){ e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }


  // ---------- Smart features ----------
  function openStats(){
    renderStats();
    openDrawer();
    document.getElementById('settingsStatsSection')?.scrollIntoView({ block:'start' });
  }
  function closeStats(){document.getElementById('statsOverlay').classList.remove('open');}
  document.getElementById('navStats')?.addEventListener('click',openStats); document.getElementById('statsClose')?.addEventListener('click',closeStats);
  document.getElementById('statsOverlay').addEventListener('click',e=>{if(e.target.id==='statsOverlay')closeStats();});
  function renderStats(){
    const tracks=playlist.filter(t=>t.kind!=='video'), artists=new Set(tracks.map(t=>t.artist||'Unknown Artist')), albums=new Set(tracks.map(t=>t.album||'Unknown Album'));
    const totalPlays=tracks.reduce((n,t)=>n+(t.playCount||0),0), totalDuration=tracks.reduce((n,t)=>n+(Number(t.duration)||0),0);
    const fmt=s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?`${h}h ${m}m`:`${m}m`};
    document.getElementById('statsGrid').innerHTML=[['Songs',tracks.length],['Artists',artists.size],['Albums',albums.size],['Total plays',totalPlays],['Known runtime',fmt(totalDuration)]].map(x=>`<div class="stat-card"><div class="stat-label">${x[0]}</div><div class="stat-value">${x[1]}</div></div>`).join('');
    const topPlayed=sortedByPlayed(tracks).filter(t=>(t.playCount||0)>0).slice(0,8), topArtists=[...artists].map(a=>({a,n:tracks.filter(t=>(t.artist||'Unknown Artist')===a).reduce((x,t)=>x+(t.playCount||0),0)})).sort((a,b)=>b.n-a.n).slice(0,8);
    document.getElementById('statsLists').innerHTML=`<div><h4>Most played songs</h4>${topPlayed.length?topPlayed.map(t=>`<div class="stats-list-row"><span>${escapeHtml(t.title)}</span><span>${t.playCount||0}</span></div>`).join(''):'<div class="stats-list-row"><span>Play something to build history.</span><span>—</span></div>'}</div><div><h4>Most played artists</h4>${topArtists.length?topArtists.map(x=>`<div class="stats-list-row"><span>${escapeHtml(x.a)}</span><span>${x.n}</span></div>`).join(''):'<div class="stats-list-row"><span>No play history yet.</span><span>—</span></div>'}</div>`;
    const settingsStatsGrid = document.getElementById('settingsStatsGrid');
    const settingsStatsLists = document.getElementById('settingsStatsLists');
    if (settingsStatsGrid) settingsStatsGrid.innerHTML = document.getElementById('statsGrid').innerHTML;
    if (settingsStatsLists) {
      const historySection = (title, list, value, empty) => `<div><h4>${title}</h4>${list.length ? list.slice(0, 8).map(t => `<div class="stats-list-row"><span>${escapeHtml(t.title)}</span><span>${value(t)}</span></div>`).join('') : `<div class="stats-list-row"><span>${empty}</span><span>—</span></div>`}</div>`;
      settingsStatsLists.innerHTML =
        historySection('Recently played', sortedByRecent(tracks.filter(t => t.lastPlayedAt)), t => formatRelativeTime(t.lastPlayedAt), 'Nothing has been played yet.') +
        historySection('Most played', sortedByPlayed(tracks.filter(t => (t.playCount || 0) > 0)), t => `${t.playCount || 0} plays`, 'Nothing has been played yet.') +
        historySection('Never played', tracks.filter(t => (t.playCount || 0) === 0).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)), () => 'never', 'Every song has been played.') +
        historySection('Recently added', sortedByAdded(tracks), t => formatRelativeTime(t.addedAt), 'No songs have been added yet.');
    }
  }

  // ---------- Equalizer ----------
  // Evenly log-spaced frequency bands — the standard consumer graphic-EQ
  // layout. The previous bands (100/1000/8000/180/1800/2400Hz) overlapped
  // badly in the low-mid range — e.g. "Mids" and "Guitar" sat almost on
  // top of each other — while leaving real gaps elsewhere in the spectrum,
  // so two sliders could affect nearly the same frequencies.
  const EQ_GROUPS=[
    {name:'31Hz',frequency:31},{name:'45Hz',frequency:45},{name:'63Hz',frequency:63},
    {name:'90Hz',frequency:90},{name:'125Hz',frequency:125},{name:'180Hz',frequency:180},
    {name:'250Hz',frequency:250},{name:'350Hz',frequency:350},{name:'500Hz',frequency:500},
    {name:'700Hz',frequency:700},{name:'1kHz',frequency:1000},{name:'1.4k',frequency:1400},
    {name:'2kHz',frequency:2000},{name:'2.8k',frequency:2800},{name:'4kHz',frequency:4000},
    {name:'5.6k',frequency:5600},{name:'8kHz',frequency:8000},{name:'11k',frequency:11000},
    {name:'16kHz',frequency:16000}
  ];
  const EQ_PRESETS={
    flat:       Array(19).fill(0),
    bass:       [7,7,6,5,5,4,3,2,1,0,0,0,0,0,0,0,0,0,0],
    treble:     [0,0,0,0,0,0,0,0,0,0,0,1,2,3,4,5,6,7,7],
    vocal:      [-2,-2,-1,0,1,2,3,4,5,5,4,3,3,2,1,0,0,0,0],
    rock:       [5,6,5,4,4,3,2,0,-2,-2,-2,0,2,3,4,4,3,2,2],
    electronic: [7,7,6,5,3,1,-1,-2,-2,-2,-1,0,2,3,4,5,6,7,7],
    acoustic:   [2,2,1,1,1,2,3,3,2,1,0,1,2,3,3,3,2,2,2],
    piano:      [1,1,0,-1,-1,0,1,2,2,2,1,0,1,2,1,0,0,1,1],
    metal:      [5,6,5,3,1,0,-2,-3,-2,0,2,3,2,4,5,4,5,4,3]
  };
  const EQ_MIN_GAIN_DB = -12;
  const EQ_MAX_GAIN_DB = 12;
  const eqState=EQ_GROUPS.map(()=>0); let eqMaster=0; let eqFilters=[]; let mediaSourceNode=null; let eqLimiterNode=null;
  function clampEqValue(value){
    const number = Number.isFinite(value) ? Number(value) : 0;
    return Math.max(EQ_MIN_GAIN_DB, Math.min(EQ_MAX_GAIN_DB, number));
  }
  function ensureEqFilters(ctx){
    if(eqFilters.length)return;
    let prev=null;
    EQ_GROUPS.forEach((g,i)=>{
      const n=ctx.createBiquadFilter(); n.type='peaking'; n.frequency.value=g.frequency; n.Q.value=1.15; n.gain.value=clampEqValue(eqState[i]);
      if(prev)prev.connect(n); prev=n; eqFilters.push({node:n,group:i});
    });
    if(prev)prev.connect(gainNode);
  }
  function rebuildEqGain(){
    if(!audioCtx||!gainNode)return;
    ensureEqFilters(audioCtx);
    const now=audioCtx.currentTime;
    const safeEqState = eqState.map(clampEqValue);
    eqFilters.forEach(x=>{
      const nextValue = clampEqValue(safeEqState[x.group]);
      x.node.gain.cancelScheduledValues(now);
      x.node.gain.setValueAtTime(x.node.gain.value,now);
      x.node.gain.linearRampToValueAtTime(nextValue,now+0.02);
    });
    const volume=Math.max(0,Math.min(1,parseFloat(volBar.value)));
    const peakBoost=Math.max(0,...safeEqState);
    const targetGain=Math.pow(10,(eqMaster-peakBoost)/20)*volume;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value,now);
    gainNode.gain.linearRampToValueAtTime(targetGain,now+0.02);
  }
  function wireFlacSource(source){
    ensureEqFilters(getCtx());
    const first=eqFilters[0]?.node; if(first)source.connect(first); else source.connect(gainNode);
  }
  function wireMediaElement(){
    try{
      ensureEqFilters(getCtx());
      if(!mediaSourceNode){mediaSourceNode=audioCtx.createMediaElementSource(mediaEl);}
      mediaSourceNode.disconnect();
      const first=eqFilters[0]?.node; if(first)mediaSourceNode.connect(first); else mediaSourceNode.connect(gainNode);
    }catch(e){}
  }
  function applyEq(){rebuildEqGain();if(currentEngine==='media')wireMediaElement();}
  function updateEqGraph(){
    const curve=document.getElementById('eqCurve'); const fill=document.getElementById('eqCurveFill'); if(!curve)return;
    const width=420; const height=145; const center=72.5;
    const logMin=Math.log10(20), logMax=Math.log10(20000);
    const positions=EQ_GROUPS.map(g=>(Math.log10(g.frequency)-logMin)/(logMax-logMin));
    const points=[];
    for(let x=0;x<=width;x+=4){
      const position=x/width; let response=0;
      EQ_GROUPS.forEach((g,i)=>{ response += eqState[i]*Math.exp(-Math.pow((position-positions[i])/0.065,2)); });
      points.push(`${x},${Math.max(7,Math.min(height-7,center-response*2.15))}`);
    }
    curve.setAttribute('points',points.join(' '));
    if(fill) fill.setAttribute('points',`0,${height} ${points.join(' ')} ${width},${height}`);
  }
  function updateEqUI(){
    document.querySelectorAll('[data-eq-index]').forEach(el=>{
      const index=Number(el.dataset.eqIndex); const v=eqState[index]; el.value=v;
      const valueEl=el.closest('.eq-band')?.querySelector('.eq-band-value');
      if(valueEl){valueEl.textContent=`${v>0?'+':''}${v} dB`;valueEl.classList.toggle('eq-band-value-boost',v>0);valueEl.classList.toggle('eq-band-value-cut',v<0);}
    });
    updateEqGraph();
  }
  function renderEqControls(){
    const grid=document.getElementById('eqGrid'); if(!grid)return;
    grid.innerHTML=EQ_GROUPS.map((g,i)=>`
      <label class="eq-band" title="${g.name} • ${g.frequency} Hz">
        <span class="eq-band-value">${eqState[i]>0?'+':''}${eqState[i]} dB</span>
        <input data-eq-index="${i}" type="range" min="${EQ_MIN_GAIN_DB}" max="${EQ_MAX_GAIN_DB}" step="1" value="${clampEqValue(eqState[i])}" aria-label="${g.name}" title="Drag to adjust; double-click to reset">
        <span class="eq-band-name">${g.name}</span>
      </label>
    `).join('');
    grid.querySelectorAll('[data-eq-index]').forEach(el=>{
      el.addEventListener('input',()=>{
        eqState[Number(el.dataset.eqIndex)]=clampEqValue(parseFloat(el.value)); document.getElementById('eqPreset').value='custom'; applyEq(); updateEqUI(); saveEqState();
      });
      el.addEventListener('dblclick',()=>{
        eqState[Number(el.dataset.eqIndex)]=0; document.getElementById('eqPreset').value='custom'; applyEq(); updateEqUI(); saveEqState();
      });
    });
    document.getElementById('eqPreset').value=eqPresetName(); updateEqUI();
  }
  function saveEqState(){try{localStorage.setItem('sleeveEq',JSON.stringify({eqState}));}catch(e){}}
  function loadEqState(){try{const x=JSON.parse(localStorage.getItem('sleeveEq')||'null');if(x&&Array.isArray(x.eqState)){x.eqState.slice(0,EQ_GROUPS.length).forEach((v,i)=>{eqState[i]=clampEqValue(Number(v)||0);});}}catch(e){}}
  function eqPresetName(){return Object.keys(EQ_PRESETS).find(name=>EQ_PRESETS[name].every((value,i)=>value===clampEqValue(eqState[i])))||'custom';}
  function setEqPreset(name){
    if(name==='custom'){updateEqUI();return;}
    const p=EQ_PRESETS[name]||EQ_PRESETS.flat; p.forEach((v,i)=>eqState[i]=clampEqValue(v));
    document.getElementById('eqPreset').value=name; applyEq();updateEqUI();saveEqState();
  }
  const eqOverlay=document.getElementById('eqOverlay'); const eqTrigger=document.getElementById('eqTrigger');
  function openEq(){eqOverlay.classList.add('open');eqTrigger.classList.add('active');eqTrigger.setAttribute('aria-expanded','true');updateEqUI();}
  function closeEq(){eqOverlay.classList.remove('open');eqTrigger.classList.remove('active');eqTrigger.setAttribute('aria-expanded','false');}
  eqTrigger.addEventListener('click',()=>eqOverlay.classList.contains('open')?closeEq():openEq());
  document.getElementById('eqClose').addEventListener('click',closeEq);
  document.addEventListener('pointerdown',e=>{if(eqOverlay.classList.contains('open')&&!eqOverlay.contains(e.target)&&!eqTrigger.contains(e.target))closeEq();});
  document.getElementById('eqPreset').addEventListener('change',e=>setEqPreset(e.target.value));
  document.getElementById('eqReset').addEventListener('click',()=>setEqPreset('flat'));
  loadEqState(); renderEqControls();


  // ---------- Favorites, queue, shuffle & recents ----------
  function currentViewTrackIds(){
    if (currentView.type === 'playlist'){
      const pl = playlists.find(p => p.id === currentView.id);
      return pl ? pl.trackIds.slice() : [];
    }
    if (currentView.type === 'album'){
      return playlist.filter(t => t.kind !== 'video' && (t.artist || 'Unknown Artist') === currentView.artist && (t.album || 'Unknown Album') === currentView.album)
        .sort((a,b) => settings.albumTrackOrder
          ? (a.trackNum || Number.MAX_SAFE_INTEGER) - (b.trackNum || Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)
          : playlist.indexOf(a) - playlist.indexOf(b)).map(t => t.id);
    }
    if (currentView.type === 'browseGroup'){
      return playlist.filter(t => t.kind !== 'video' && (currentView.mode === 'year'
        ? ((t.year || '').toString().trim() || 'Unknown Year')
        : ((t.genre || '').trim() || 'Unknown Genre')) === currentView.value).map(t => t.id);
    }
    return playlist.map(t => t.id);
  }

  function getQueueIds(){
    queueIds = queueIds.filter(id => playlist.some(t => t.id === id));
    return queueIds;
  }

  // "Add to queue" — this is the one thing that should NOT get wiped out
  // when you click a track in a different playlist/album/group. It goes
  // into a separate manual queue that getQueueOrder() splices in right
  // after whatever's currently playing, and it sticks around until it's
  // actually been played.
  function queueTrack(id, mode='end'){
    if (!playlist.some(t => t.id === id)) return;
    manualQueueIds = manualQueueIds.filter(qid => qid !== id);
    if (mode === 'next') manualQueueIds.unshift(id);
    else manualQueueIds.push(id);
    renderQueue();
  }

  function removeFromQueue(id){
    manualQueueIds = manualQueueIds.filter(qid => qid !== id);
    queueIds = queueIds.filter(qid => qid !== id);
    renderQueue();
  }

  function shuffleArray(arr){
    for (let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function setShuffle(on){
    const next = !!on;
    if (next && !shuffleEnabled && queueIds.length > 1){
      const currentId = currentIndex >= 0 ? playlist[currentIndex].id : null;
      const rest = queueIds.filter(id => id !== currentId);
      queueIds = currentId ? [currentId, ...shuffleArray(rest)] : shuffleArray(queueIds.slice());
    }
    shuffleEnabled = next;
    const btn = document.getElementById('shuffleBtn');
    if (btn){ btn.classList.toggle('active', shuffleEnabled); btn.title = shuffleEnabled ? 'Shuffle on' : 'Shuffle off'; }
    renderQueue();
  }

  function setRepeat(mode){
    repeatMode = ['off','all','one'].includes(mode) ? mode : 'off';
    const btn = document.getElementById('repeatBtn');
    if (!btn) return;
    btn.classList.toggle('active', repeatMode !== 'off');
    btn.textContent = repeatMode === 'one' ? '↻1' : '↻';
    btn.title = repeatMode === 'off' ? 'Repeat off' : repeatMode === 'all' ? 'Repeat all' : 'Repeat one';
  }

  function getEffectiveQueueIds(){
    let ids = getQueueIds();
    if (ids.length > 0) return ids.slice();
    ids = currentViewTrackIds();
    return ids.length ? ids : playlist.map(t => t.id);
  }

  function renderQueue(){
    const list = document.getElementById('queueList');
    if (!list) return;
    const manualIds = manualQueueIds.filter(id => playlist.some(t => t.id === id));
    const contextIds = queueIds.filter(id => playlist.some(t => t.id === id));
    list.innerHTML = '';
    if (!manualIds.length && !contextIds.length){ list.innerHTML = '<div class="queue-empty">Nothing queued yet.<br>Add tracks with the <b>+</b> queue button, or start playing a view.</div>'; return; }

    function buildRow(id, isManual){
      const t = playlist.find(x => x.id === id);
      if (!t) return null;
      const row = document.createElement('div');
      row.className = 'queue-row' + (currentIndex !== -1 && playlist[currentIndex].id === id ? ' active' : '');
      row.draggable = true;
      row.dataset.trackId = id;
      const art = t.thumbUrl ? `<img src="${t.thumbUrl}" loading="lazy" decoding="async" alt="">` : iconFor(t.kind);
      row.innerHTML = `<div class="queue-grip">☷</div><div class="queue-row-art">${art}</div><div class="queue-row-meta"><div class="queue-row-title">${escapeHtml(t.title)}</div><div class="queue-row-sub">${escapeHtml(t.artist || (t.kind === 'video' ? 'Video' : 'Unknown Artist'))}</div></div><button class="queue-remove" type="button" title="Remove from queue">×</button>`;
      row.addEventListener('click', e => {
        if (e.target.closest('.queue-remove')) return;
        const idx2 = playlist.findIndex(x => x.id === id);
        if (idx2 !== -1) playTrackAt(idx2, true);
      });
      row.querySelector('.queue-remove').addEventListener('click', e => { e.stopPropagation(); removeFromQueue(id); });
      row.addEventListener('dragstart', () => row.classList.add('dragging'));
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => {
        e.preventDefault();
        const fromId = parseInt(document.querySelector('.queue-row.dragging')?.dataset.trackId || '', 10);
        const toId = id;
        if (!Number.isFinite(fromId) || fromId === toId) return;
        // Keep drag-reordering within whichever list (manual/context) the row belongs to.
        const arr = isManual ? manualQueueIds : queueIds;
        const from = arr.indexOf(fromId), to = arr.indexOf(toId);
        if (from === -1 || to === -1) return;
        arr.splice(from,1); arr.splice(to,0,fromId); renderQueue();
      });
      return row;
    }

    if (manualIds.length){
      const label = document.createElement('div');
      label.className = 'queue-section-label';
      label.textContent = 'Up next';
      list.appendChild(label);
      manualIds.forEach(id => { const row = buildRow(id, true); if (row) list.appendChild(row); });
    }
    if (contextIds.length){
      if (manualIds.length){
        const label = document.createElement('div');
        label.className = 'queue-section-label';
        label.textContent = 'Playing from this list';
        list.appendChild(label);
      }
      contextIds.forEach(id => { const row = buildRow(id, false); if (row) list.appendChild(row); });
    }
  }

  function openQueue(){ document.getElementById('queuePanel')?.classList.add('open'); renderQueue(); }
  function closeQueue(){ document.getElementById('queuePanel')?.classList.remove('open'); }

  function markPlayed(track){
    if (!track || track._playMarkedForSession) return;
    track._playMarkedForSession = true;
    track.playCount = (track.playCount || 0) + 1;
    track.lastPlayedAt = Date.now();
    dbPut(track);
  }

  // ---------- Playlists ----------

  // In-app replacement for window.prompt(), which Electron's renderer
  // does not implement (it just returns null instantly).
  function showPrompt(title, defaultValue){
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-box">
          <h3>${escapeHtml(title)}</h3>
          <input class="modal-input" type="text" maxlength="200">
          <div class="modal-actions">
            <button class="modal-btn" type="button" data-action="cancel">Cancel</button>
            <button class="modal-btn modal-btn-primary" type="button" data-action="ok">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('.modal-input');
      input.value = defaultValue || '';
      input.focus();
      input.select();

      let settled = false;
      function finish(value){
        if (settled) return;
        settled = true;
        overlay.remove();
        document.removeEventListener('keydown', onKeydown, true);
        resolve(value);
      }
      function onKeydown(e){
        e.stopPropagation();
        if (e.key === 'Enter'){ e.preventDefault(); finish(input.value); }
        else if (e.key === 'Escape'){ e.preventDefault(); finish(null); }
      }
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) finish(null);
      });
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(null));
      overlay.querySelector('[data-action="ok"]').addEventListener('click', () => finish(input.value));
      document.addEventListener('keydown', onKeydown, true);
    });
  }

  navHome.addEventListener('click', () => {
    clearSelection();
    currentView = { type: 'home' };
    scheduleRender(searchInput.value);
  });

  document.getElementById('shuffleBtn').addEventListener('click', () => { setShuffle(!shuffleEnabled); });
  document.getElementById('repeatBtn').addEventListener('click', () => {
    setRepeat(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off');
  });
  document.getElementById('playerQueueBtn').addEventListener('click', openQueue);
  document.getElementById('queueCloseBtn').addEventListener('click', closeQueue);
  document.getElementById('queueClearBtn').addEventListener('click', () => { queueIds = []; manualQueueIds = []; renderQueue(); });
  document.getElementById('queueShuffleBtn').addEventListener('click', () => { queueIds = shuffleArray(getQueueIds()); setShuffle(true); renderQueue(); });
  document.addEventListener('click', e => {
    const panel = document.getElementById('queuePanel');
    if (!panel || !panel.classList.contains('open')) return;
    if (panel.contains(e.target) || e.target.closest('#playerQueueBtn')) return;
    if (e.target.closest('.queue-panel')) return;
    // Keep the panel open for normal app interaction; Esc or the close button dismisses it.
  });

  navArtists.addEventListener('click', () => {
    currentView = { type: 'artists' };
    scheduleRender(searchInput.value);
  });

  navBrowse.addEventListener('click', () => {
    currentView = { type: 'browse', mode: (currentView.mode === 'genre' ? 'genre' : 'year') };
    scheduleRender(searchInput.value);
  });

  browseSwitchYear.addEventListener('click', () => {
    currentView = { type: 'browse', mode: 'year' };
    scheduleRender(searchInput.value);
  });

  browseSwitchGenre.addEventListener('click', () => {
    currentView = { type: 'browse', mode: 'genre' };
    scheduleRender(searchInput.value);
  });

  newMusicPlaylistBtn.addEventListener('click', async () => {
    const pl = await promptNewPlaylist('music');
    if (pl) scheduleRender(searchInput.value);
  });
  newVideoPlaylistBtn.addEventListener('click', async () => {
    const pl = await promptNewPlaylist('video');
    if (pl) scheduleRender(searchInput.value);
  });

  // Smart/generated playlists: turns "most played", "least played", etc.
  // into a real, ordinary playlist (pinnable, renameable, deletable, just
  // like one you built by hand) instead of a rotating home-page shelf.
  const SMART_PLAYLIST_CRITERIA = [
    { key: 'mostPlayed', title: 'Most Played', sub: 'Your heaviest rotation, in one place' },
    { key: 'leastPlayed', title: 'Least Played', sub: "Songs you own but rarely reach for" },
    { key: 'recentlyAdded', title: 'Recently Added', sub: 'Newest additions to your library' },
    { key: 'random', title: 'Random Mix', sub: 'A shuffled grab-bag for a change of pace' },
  ];
  const SMART_PLAYLIST_SIZE = 25;

  function showGeneratePlaylistChooser(){
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-box modal-box-wide">
          <h3>What should this playlist be based on?</h3>
          <div class="modal-option-list">
            ${SMART_PLAYLIST_CRITERIA.map(c => `
              <button class="modal-option-btn" type="button" data-key="${c.key}">
                <span class="modal-option-title">${escapeHtml(c.title)}</span>
                <span class="modal-option-sub">${escapeHtml(c.sub)}</span>
              </button>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button class="modal-btn" type="button" data-action="cancel">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      let settled = false;
      function finish(value){
        if (settled) return;
        settled = true;
        overlay.remove();
        document.removeEventListener('keydown', onKeydown, true);
        resolve(value);
      }
      function onKeydown(e){
        e.stopPropagation();
        if (e.key === 'Escape'){ e.preventDefault(); finish(null); }
      }
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) finish(null);
      });
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(null));
      overlay.querySelectorAll('.modal-option-btn').forEach(btn => {
        btn.addEventListener('click', () => finish(btn.dataset.key));
      });
      document.addEventListener('keydown', onKeydown, true);
    });
  }

  function pickTracksForCriterion(criterion){
    const musicTracks = playlist.filter(t => t.kind !== 'video');
    switch (criterion){
      case 'mostPlayed':
        return musicTracks
          .filter(t => (t.playCount || 0) > 0)
          .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
          .slice(0, SMART_PLAYLIST_SIZE);
      case 'leastPlayed':
        return musicTracks
          .slice()
          .sort((a, b) => (a.playCount || 0) - (b.playCount || 0))
          .slice(0, SMART_PLAYLIST_SIZE);
      case 'recentlyAdded':
        return sortedByAdded(musicTracks).slice(0, SMART_PLAYLIST_SIZE);
      case 'random':
        return shuffleArray(musicTracks.slice()).slice(0, SMART_PLAYLIST_SIZE);
      default:
        return [];
    }
  }

  function uniquePlaylistName(baseName){
    if (!playlists.some(p => p.name === baseName)) return baseName;
    let n = 2;
    while (playlists.some(p => p.name === `${baseName} ${n}`)) n++;
    return `${baseName} ${n}`;
  }

  async function generateSmartPlaylist(){
    const criterion = await showGeneratePlaylistChooser();
    if (!criterion) return null;

    const meta = SMART_PLAYLIST_CRITERIA.find(c => c.key === criterion);
    const picked = pickTracksForCriterion(criterion);

    if (!picked.length){
      alert("There isn't enough listening history yet to build that playlist.");
      return null;
    }

    const pl = {
      id: nextPlaylistId++,
      name: uniquePlaylistName(`${meta.title} Mix`),
      type: 'music',
      trackIds: picked.map(t => t.id),
    };
    playlists.push(pl);
    dbPutPlaylist(pl);
    scheduleRender(searchInput.value);
    return pl;
  }

  document.getElementById('generateSmartPlaylistBtn').addEventListener('click', generateSmartPlaylist);

  async function promptNewPlaylist(type, prefillTrackId){
    if (typeof type !== 'string'){
      prefillTrackId = type;
      type = 'music';
    }
    const name = await showPrompt(`${type === 'video' ? 'Video' : 'Music'} playlist name:`, '');
    if (!name || !name.trim()) return null;
    const pl = { id: nextPlaylistId++, name: name.trim(), type, trackIds: prefillTrackId != null ? [prefillTrackId] : [] };
    playlists.push(pl);
    dbPutPlaylist(pl);
    return pl;
  }

  function togglePlaylistTrack(playlistId, trackId, add){
    const pl = playlists.find(p => p.id === playlistId);
    const track = playlist.find(item => item.id === trackId);
    if (!pl) return;
    if (track && (pl.type || 'music') !== (track.kind === 'video' ? 'video' : 'music')) return;
    if (add){
      if (!pl.trackIds.includes(trackId)) pl.trackIds.push(trackId);
    } else {
      pl.trackIds = pl.trackIds.filter(id => id !== trackId);
    }
    dbPutPlaylist(pl);
    scheduleRender(searchInput.value);
  }

  let menuEl = null;
  function closePlaylistMenu(){
    if (menuEl){ menuEl.remove(); menuEl = null; }
    document.removeEventListener('mousedown', onDocClickCloseMenu, true);
  }
  function onDocClickCloseMenu(e){
    if (menuEl && !menuEl.contains(e.target)) closePlaylistMenu();
  }

  function openPlaylistMenu(trackId, anchorEl){
    closePlaylistMenu();
    const track = playlist.find(item => item.id === trackId);
    const playlistType = track && track.kind === 'video' ? 'video' : 'music';
    const compatiblePlaylists = playlists.filter(pl => (pl.type || 'music') === playlistType);
    const menu = document.createElement('div');
    menu.className = 'playlist-menu';
    const rows = compatiblePlaylists.map(pl => {
      const checked = pl.trackIds.includes(trackId);
      return `<label class="playlist-menu-item">
        <input type="checkbox" data-pid="${pl.id}" ${checked ? 'checked' : ''}>
        <span>${escapeHtml(pl.name)}</span>
      </label>`;
    }).join('');
    menu.innerHTML = `
      ${compatiblePlaylists.length ? rows : `<div class="playlist-menu-empty">No ${playlistType} playlists yet</div>`}
      <button class="playlist-menu-new" id="playlistMenuNew" type="button">+ New ${playlistType} playlist</button>
    `;
    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    const top = Math.min(rect.bottom + 4, window.innerHeight - 60);
    const left = Math.min(rect.left, window.innerWidth - 244);
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, left)}px`;

    menu.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        togglePlaylistTrack(parseInt(cb.dataset.pid, 10), trackId, cb.checked);
      });
    });
    menu.querySelector('#playlistMenuNew').addEventListener('click', async () => {
      closePlaylistMenu();
      const pl = await promptNewPlaylist(playlistType, trackId);
      if (pl) scheduleRender(searchInput.value);
    });

    menuEl = menu;
    setTimeout(() => document.addEventListener('mousedown', onDocClickCloseMenu, true), 0);
  }


  let trackActionsMenu = null;
  let trackActionsDismissBound = false;
  function closeTrackActions(){
    if (trackActionsMenu){
      trackActionsMenu.remove();
      trackActionsMenu = null;
    }
    if (trackActionsDismissBound){
      document.removeEventListener('pointerdown', closeActionsOnDoc, true);
      document.removeEventListener('wheel', closeTrackActions, true);
      window.removeEventListener('resize', closeTrackActions);
      window.removeEventListener('scroll', closeTrackActions, true);
      trackActionsDismissBound = false;
    }
  }
  function openTrackActions(trackId, anchor){
    closeTrackActions();
    const t=playlist.find(x=>x.id===trackId); if(!t)return;
    const menu=document.createElement('div'); menu.className='track-actions-menu';
    menu.setAttribute('role','menu');
    menu.innerHTML = `<button class="track-actions-close" type="button" title="Close" aria-label="Close menu">×</button>`;
    const items=[
      ['Play',()=>playTrackAt(playlist.indexOf(t),true)],
      ['Play next',()=>queueTrack(t.id,'next')],
      ['Add to queue',()=>queueTrack(t.id,'end')],
      ['Add to playlist',()=>openPlaylistMenu(t.id, anchor)],
      ['Edit metadata',()=>openMetadataEditor(t.id)],
      ['Rename song',()=>startInlineRename(findTrackTitleElement(t.id),t)],
      ['Source / reveal location',()=>showTrackSource(t)],
      ['Remove from library',()=>removeTrackFromLibrary(t.id),true]
    ];
    menu.insertAdjacentHTML('beforeend', items.map((it,i)=>`<button class="track-action-item${it[2]?' danger':''}" data-i="${i}" type="button" role="menuitem">${it[0]}</button>`).join(''));
    const closeMenuBtn = menu.querySelector('.track-actions-close');
    const closeMenuNow = (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTrackActions();
    };
    closeMenuBtn.addEventListener('pointerdown', closeMenuNow, true);
    closeMenuBtn.addEventListener('mousedown', closeMenuNow, true);
    closeMenuBtn.addEventListener('click', closeMenuNow, true);
    document.body.appendChild(menu);
    items.forEach((it,i)=>menu.querySelector(`[data-i="${i}"]`).addEventListener('click',()=>{closeTrackActions();it[1]();}));
    const rect=anchor.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-228))+'px';
    menu.style.top=Math.max(8,Math.min(rect.bottom+4,window.innerHeight-380))+'px';
    trackActionsMenu=menu;
    trackActionsDismissBound = true;
    setTimeout(()=>document.addEventListener('pointerdown',closeActionsOnDoc,true),0);
    document.addEventListener('wheel', closeTrackActions, true);
    window.addEventListener('resize', closeTrackActions);
    window.addEventListener('scroll', closeTrackActions, true);
  }
  function closeActionsOnDoc(e){
    if(trackActionsMenu && !trackActionsMenu.contains(e.target)) closeTrackActions();
  }
  function findTrackTitleElement(trackId){
    return document.querySelector(`[data-track-id="${trackId}"] .card-title, [data-track-id="${trackId}"] .track-title`) || document.body;
  }
  function showTrackSource(t){
    const p=t.sourcePath || t.file?.webkitRelativePath || t.file?.path || t.file?.name || 'Unknown source';
    if(window.electronAPI?.showItemInFolder && t.file?.path) { window.electronAPI.showItemInFolder(t.file.path); return; }
    alert(`Source:\n${p}\n\nIn a browser, the original folder cannot be opened directly. Electron can reveal it when the app exposes a file-location API.`);
  }
  async function removeTrackFromLibrary(id){
    const t=playlist.find(x=>x.id===id); if(!t)return;
    if(!confirm(`Remove "${t.title}" from your library?`))return;
    if(currentIndex===playlist.indexOf(t)) stopEverything();
    playlists.forEach(pl=>{pl.trackIds=pl.trackIds.filter(x=>x!==id);dbPutPlaylist(pl);});
    queueIds=queueIds.filter(x=>x!==id); activeQueueIds=(activeQueueIds||[]).filter(x=>x!==id); manualQueueIds=manualQueueIds.filter(x=>x!==id);
    playlist=playlist.filter(x=>x.id!==id);
    const db=await openDB(); if(db){try{db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);}catch(e){}}
    currentIndex=-1; scheduleRender(searchInput.value); renderQueue();
  }


  const playlistThumbInput=document.getElementById('playlistThumbInput');
  let playlistThumbTarget=null;
  function openPlaylistThumbPicker(pl){ playlistThumbTarget=pl; playlistThumbInput.value=''; playlistThumbInput.click(); }
  playlistThumbInput.addEventListener('change',()=>{
    const file=playlistThumbInput.files?.[0]; const pl=playlistThumbTarget; playlistThumbTarget=null; if(!file||!pl)return;
    const fr=new FileReader(); fr.onload=async()=>{pl.thumb=fr.result; await dbPutPlaylist(pl); scheduleRender(searchInput.value);}; fr.readAsDataURL(file);
  });

  function renderPlaylistList(){
    navHome.classList.toggle('active', currentView.type === 'home');
    navArtists.classList.toggle('active', currentView.type === 'artists' || currentView.type === 'artistAlbums' || currentView.type === 'album');
    navBrowse.classList.toggle('active', currentView.type === 'browse' || currentView.type === 'browseGroup');
    function renderGroup(container, type){
      container.innerHTML = '';
      const group = playlists.filter(pl => (pl.type || 'music') === type);
      if (group.length === 0){
        const d = document.createElement('div');
        d.className = 'empty-shelf';
        d.textContent = `No ${type} playlists yet.`;
        container.appendChild(d);
        return;
      }
      group.forEach(pl => {
      const item = document.createElement('button');
      item.className = 'nav-item playlist-item' + (currentView.type === 'playlist' && currentView.id === pl.id ? ' active' : '');
      item.innerHTML = `
        <div class="playlist-thumb-wrap">${pl.thumb ? `<img src="${pl.thumb}" loading="lazy" decoding="async" alt="">` : (type === 'video' ? '<span>▣</span>' : '<span>♫</span>')}<button class="playlist-thumb-btn" type="button" title="Set playlist artwork">✎</button></div>
        <span class="playlist-item-name">${escapeHtml(pl.name)}</span>
        <span class="playlist-item-count">${pl.trackIds.length}</span>
        <button class="playlist-rename-btn" type="button" title="Rename playlist">&#9998;</button>
        <button class="playlist-delete-btn" type="button" title="Delete playlist">&times;</button>
      `;
      
      item.addEventListener('click', (e) => {
        if (e.target.closest('.playlist-thumb-btn') || e.target.closest('.playlist-rename-btn') || e.target.closest('.playlist-delete-btn')) return;
        currentView = { type: 'playlist', id: pl.id };
        // A playlist's stored trackIds are its source of truth for playback order.
        // Clear the previous view/queue so an older library/import order cannot leak in.
        queueIds = pl.trackIds.slice();
        activeQueueIds = queueIds.slice();
        if (shuffleEnabled) queueIds = shuffleArray(queueIds);
        scheduleRender(searchInput.value);
      });
      item.querySelector('.playlist-thumb-btn').addEventListener('click', (e) => { e.stopPropagation(); openPlaylistThumbPicker(pl); });
      item.addEventListener('dragover', e => { e.preventDefault(); item.classList.add('drag-target'); });
      item.addEventListener('dragleave', () => item.classList.remove('drag-target'));
      item.addEventListener('drop', e => { e.preventDefault(); item.classList.remove('drag-target'); const id=Number(e.dataTransfer.getData('text/plain')); if(Number.isFinite(id)) togglePlaylistTrack(pl.id,id,true); });
      item.querySelector('.playlist-rename-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = await showPrompt('Rename playlist:', pl.name);
        if (!name || !name.trim() || name.trim() === pl.name) return;
        pl.name = name.trim();
        await dbPutPlaylist(pl);
        scheduleRender(searchInput.value);
      });
      item.querySelector('.playlist-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete playlist "${pl.name}"? Your tracks will stay in your library.`)) return;
        playlists = playlists.filter(p => p.id !== pl.id);
        await dbDeletePlaylist(pl.id);
        if (currentView.type === 'playlist' && currentView.id === pl.id) currentView = { type: 'home' };
        scheduleRender(searchInput.value);
      });
      container.appendChild(item);
      });
    }
    renderGroup(musicPlaylistList, 'music');
    renderGroup(videoPlaylistList, 'video');
  }


  function matchesTrackQuery(t, query){
    if (!query) return true;
    const q = query.toLowerCase();
    return [t.title,t.artist,t.album,t.genre,t.year,t.kind].some(v => String(v || '').toLowerCase().includes(q));
  }

  function sortedByRecent(list){ return list.slice().sort((a,b)=>(b.lastPlayedAt||0)-(a.lastPlayedAt||0)); }
  function sortedByAdded(list){ return list.slice().sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)); }
  function sortedByPlayed(list){ return list.slice().sort((a,b)=>(b.playCount||0)-(a.playCount||0)); }

  function renderSmartHome(query){
    let wrap = document.getElementById('smartHomeWrap');
    if (wrap) wrap.remove();
    if (currentView.type !== 'home' || query) return;
    const sections=[];
    const tracks=playlist.filter(t=>t.kind!=='video');
    const section=(title,list,statFn,label)=>{
      if(!list.length)return;
      const el=document.createElement('section');
      el.className='smart-section';
      const top=list.slice(0,6);
      const collapsed=!!(settings.smartCollapsed && settings.smartCollapsed[label]);
      if(collapsed) el.classList.add('collapsed');
      const head=document.createElement('div');
      head.className='smart-section-head';
      const toggle=document.createElement('button');
      toggle.type='button';
      toggle.className='smart-section-toggle';
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.innerHTML=`<span class="smart-section-chevron">▾</span><span class="smart-section-title">${title}</span>`;
      toggle.addEventListener('click', (e)=>{
        e.preventDefault();
        const isCollapsed=el.classList.toggle('collapsed');
        settings.smartCollapsed=settings.smartCollapsed || {};
        settings.smartCollapsed[label]=isCollapsed;
        toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        saveSettings();
      });
      head.appendChild(toggle);
      el.appendChild(head);
      const body=document.createElement('div');
      body.className='smart-section-body';
      top.forEach(t=>{const row=document.createElement('div');row.className='smart-track-row';const art=t.thumbUrl?`<img src="${t.thumbUrl}" loading="lazy" decoding="async" alt="">`:iconFor(t.kind);row.innerHTML=`<div class="smart-track-art">${art}</div><div class="smart-track-meta"><div class="smart-track-title">${escapeHtml(t.title)}</div><div class="smart-track-sub">${escapeHtml(t.artist||'Unknown Artist')} · ${escapeHtml(t.album||'Unknown Album')}</div></div><div class="smart-track-stat">${statFn(t)}</div>`;row.addEventListener('click',()=>playTrackAt(playlist.indexOf(t),true));body.appendChild(row);});
      el.appendChild(body); sections.push(el);
    };
    if(settings.smartRecentlyAdded!==false) section('Recently Added',sortedByAdded(tracks),t=>formatRelativeTime(t.addedAt),'added');
    if(settings.smartRecentlyPlayed!==false) section('Recently Played',sortedByRecent(tracks.filter(t=>t.lastPlayedAt)),t=>formatRelativeTime(t.lastPlayedAt),'played');
    if(settings.smartMostPlayed) section('Most Played',sortedByPlayed(tracks.filter(t=>(t.playCount||0)>0)),t=>`${t.playCount||0} plays`,'plays');
    if(settings.smartNeverPlayed) section('Never Played',tracks.filter(t=>(t.playCount||0)===0).sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)),()=> 'new','never');
    if(!sections.length)return;
    wrap=document.createElement('div');wrap.id='smartHomeWrap';wrap.className='smart-home-wrap';sections.forEach(x=>wrap.appendChild(x));
    cardGrid.parentElement.insertBefore(wrap,cardGrid);
  }
  function formatRelativeTime(ts){
    if(!ts)return '—'; const d=Math.max(0,Date.now()-ts),m=Math.floor(d/60000),h=Math.floor(m/60),day=Math.floor(h/24);
    if(m<1)return 'just now'; if(m<60)return `${m}m ago`; if(h<24)return `${h}h ago`; if(day<30)return `${day}d ago`; return new Date(ts).toLocaleDateString();
  }

 // ---------- Amazon Music preset home ----------
  function renderAmazonMusicHome(query){
    const oldWrap = document.getElementById('amazonHomeWrap');
    if (oldWrap) oldWrap.remove();

    const active = settings.appPreset === 'amazonMusic'
      && currentView.type === 'home'
      && !query;

    document.body.classList.toggle('amazon-home-active', active);
    if (!active) return;

    const mainContent = cardGrid?.parentElement;
    if (!mainContent) return;

    const wrap = document.createElement('div');
    wrap.id = 'amazonHomeWrap';
    wrap.className = 'amazon-home-wrap';

    const addSection = (title, label, className, buildContent) => {
      const section = document.createElement('section');
      section.className = `amazon-home-section ${className || ''}`;

      const heading = document.createElement('div');
      heading.className = 'amazon-home-heading';
      heading.innerHTML = `<h2>${escapeHtml(title)}</h2><span>${escapeHtml(label)}</span>`;
      section.appendChild(heading);

      buildContent(section);
      wrap.appendChild(section);
    };

    // 1. Artists — full-width row across the main page.
    const artists = getArtists().slice().sort((a, b) => a.name.localeCompare(b.name));
    addSection('Artists', `${artists.length} artists`, 'amazon-artists-section', (section) => {
      const row = document.createElement('div');
      row.className = 'amazon-artist-row';

      artists.forEach(({ name, tracks }) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'amazon-artist-card';

        const entry = artistThumbs.get(name);
        const art = entry
          ? `<img src="${entry.url}" loading="lazy" decoding="async" alt="">`
          : `<div class="amazon-artist-placeholder">${PERSON_ICON}</div>`;

        card.innerHTML = `${art}<span class="name">${escapeHtml(name)}</span><span class="meta">${tracks.length} track${tracks.length === 1 ? '' : 's'}</span>`;

        card.addEventListener('click', () => {
          currentView = { type: 'artistAlbums', artist: name };
          scheduleRender(searchInput.value);
        });

        row.appendChild(card);
      });

      if (!artists.length){
        row.innerHTML = '<div class="empty-shelf">No artists yet.</div>';
      }

      section.appendChild(row);
    });

    // 2. Playlists — full-width row under Artists.
    const musicPlaylists = playlists
      .filter(pl => (pl.type || 'music') === 'music')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    addSection('Playlists', `${musicPlaylists.length} playlists`, 'amazon-playlists-section', (section) => {
      const row = document.createElement('div');
      row.className = 'amazon-playlist-row';

      musicPlaylists.forEach((pl) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'amazon-playlist-card';

        const art = pl.thumb
          ? `<img src="${pl.thumb}" loading="lazy" decoding="async" alt="">`
          : `<div class="amazon-playlist-art" style="display:flex;align-items:center;justify-content:center;background:#162231;color:#6280a0;font-size:30px;">♫</div>`;

        card.innerHTML = `<div class="amazon-playlist-art">${art}</div><span class="name">${escapeHtml(pl.name)}</span><span class="meta">${pl.trackIds.length} track${pl.trackIds.length === 1 ? '' : 's'}</span>`;

        card.addEventListener('click', () => {
          currentView = { type: 'playlist', id: pl.id };
          queueIds = pl.trackIds.slice();
          activeQueueIds = queueIds.slice();
          if (shuffleEnabled) queueIds = shuffleArray(queueIds);
          scheduleRender(searchInput.value);
        });

        row.appendChild(card);
      });

      if (!musicPlaylists.length){
        row.innerHTML = '<div class="empty-shelf">No music playlists yet.</div>';
      }

      section.appendChild(row);
    });

    // 3. Your Library — full-width song list beneath playlists.
    const songs = playlist
      .filter(track => track.kind !== 'video')
      .slice()
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const songIds = songs.map(track => track.id);

    addSection('Your Library', `${songs.length} songs`, 'amazon-library-section', (section) => {
      const list = document.createElement('div');
      list.className = 'amazon-library';

      songs.forEach((track) => {
        const row = document.createElement('div');
        row.className = 'amazon-library-row';

        const artUrl = track.thumbUrl || '';
        const art = artUrl
          ? `<img src="${artUrl}" loading="lazy" decoding="async" alt="">`
          : iconFor(track.kind);

        row.innerHTML = `
          <div class="amazon-library-art">${art}</div>
          <div class="amazon-library-title">${escapeHtml(track.title)}</div>
          <div class="amazon-library-sub">${escapeHtml(track.artist || 'Unknown Artist')} · ${escapeHtml(track.album || 'Unknown Album')}</div>
          <div class="amazon-library-kind">${escapeHtml(track.kind === 'flac' ? 'FLAC' : 'Audio')}</div>
        `;

        row.addEventListener('click', () => {
          const index = playlist.indexOf(track);
          if (index !== -1) playTrackAt(index, true, songIds);
        });

        list.appendChild(row);
      });

      if (!songs.length){
        list.innerHTML = '<div class="empty-shelf">Nothing added to your library yet.</div>';
      }

      section.appendChild(list);
    });

    mainContent.insertBefore(wrap, cardGrid);
  }


  // ---------- Performance: coalesce expensive UI renders ----------
  let renderFramePending = false;
  let pendingRenderQuery = null;
  let pendingSkipSidebar = true;

  function scheduleRender(query, opts){
    pendingRenderQuery = query == null ? searchInput.value : query;
    const wantsSkipSidebar = !!(opts && opts.skipSidebar);
    if (!renderFramePending){
      pendingSkipSidebar = wantsSkipSidebar;
    } else if (!wantsSkipSidebar){
      // If any queued call in this animation frame needs a full render,
      // the whole batch gets a full render — skipping is only safe when
      // every pending caller agrees the sidebar doesn't need rebuilding.
      pendingSkipSidebar = false;
    }
    if (renderFramePending) return;
    renderFramePending = true;
    requestAnimationFrame(() => {
      renderFramePending = false;
      const q = pendingRenderQuery;
      const skip = pendingSkipSidebar;
      pendingRenderQuery = null;
      pendingSkipSidebar = true;
      renderAll(q, { skipSidebar: skip });
    });
  }

  // ---------- Large-library virtualization ----------
  const virtualMain = document.querySelector('.main');
  let virtualRenderQueued = false;
  let virtualLastWindowStart = -1;
  let virtualLastWindowEnd = -1;
  let virtualLastMode = '';
  let lastRenderIsVirtualizable = false;
  let lastRenderVisibleCount = 0;

  function getVirtualWindow(total, itemHeight, gap){
  if (paginationInitialized && total > ITEMS_PER_PAGE) {
    return { start:0, end:total, before:0, after:0, enabled:false };
  }
  if (!virtualMain || total < 80 || settings.view === 'list') return { start:0, end:total, before:0, after:0, enabled:false };
  const gridTop = cardGrid.getBoundingClientRect().top + virtualMain.scrollTop - virtualMain.getBoundingClientRect().top;
    const viewportTop = Math.max(0, virtualMain.scrollTop - gridTop);
    const viewportHeight = Math.max(400, virtualMain.clientHeight);
    const columns = Math.max(1, Math.floor((Math.max(1, cardGrid.clientWidth) + settings.cardGap) / (Math.max(120, settings.cardSize) + settings.cardGap)));
    const rowSpan = Math.max(170, itemHeight + settings.cardGap);
    const firstRow = Math.max(0, Math.floor(viewportTop / rowSpan) - 2);
    const lastRow = Math.min(Math.ceil(total / columns), Math.ceil((viewportTop + viewportHeight) / rowSpan) + 2);
    const start = firstRow * columns;
    const end = Math.min(total, lastRow * columns);
    return { start, end, before:firstRow, after:Math.max(0, Math.ceil(total/columns)-lastRow), columns, rowSpan, enabled:true };
  }

  function queueVirtualScrollRender(){
    // Nothing to do unless the page currently showing is actually the
    // virtualized flat track grid, and it's big enough to matter — this
    // stops Artists, Browse, and small lists
    // from ever being re-rendered just because the user scrolled.
    if (!lastRenderIsVirtualizable || lastRenderVisibleCount < 80) return;
    if (virtualRenderQueued) return;
    virtualRenderQueued = true;
    requestAnimationFrame(() => {
      virtualRenderQueued = false;
      if (!lastRenderIsVirtualizable || lastRenderVisibleCount < 80) return;
      if (!virtualMain || virtualMain.scrollHeight <= virtualMain.clientHeight) return;
      const mode = `${currentView.type}|${settings.view}|${settings.cardSize}|${settings.cardGap}`;
      const probe = getVirtualWindow(lastRenderVisibleCount, 220, settings.cardGap);
      if (!probe.enabled) return;
      if (probe.start === virtualLastWindowStart && probe.end === virtualLastWindowEnd && mode === virtualLastMode) return;
      scheduleRender(searchInput.value, { skipSidebar: true });
    });
  }

  if (virtualMain) virtualMain.addEventListener('scroll', queueVirtualScrollRender, { passive:true });
  // Window resizes (or a sidebar/card-size change reflowing the grid) can
  // change how many columns fit per row, which the virtual window's
  // start/end indices depend on — recheck so they don't go stale.
  window.addEventListener('resize', () => queueVirtualScrollRender(), { passive:true });



  function renderAll(query, opts){
    renderPlaylistList();
    const skipSidebar = !!(opts && opts.skipSidebar);
    query = (query || '').toLowerCase();

    let activePlaylist = currentView.type === 'playlist' ? playlists.find(p => p.id === currentView.id) : null;
    if (currentView.type === 'playlist' && !activePlaylist) currentView = { type: 'home' };

    const isArtists = currentView.type === 'artists';
    const isArtistAlbums = currentView.type === 'artistAlbums';
    const isAlbum = currentView.type === 'album';
    const isBrowse = currentView.type === 'browse';
    const isBrowseGroup = currentView.type === 'browseGroup';

    let artistsData = null, albumsData = null;
    if (isArtists){
      artistsData = getArtists().filter(a => !query || a.name.toLowerCase().includes(query));
    } else if (isArtistAlbums){
      // Guard against a stale view if every track from this artist was deleted.
      if (getArtists().every(a => a.name !== currentView.artist)) currentView = { type: 'artists' };
      else albumsData = getAlbumsForArtist(currentView.artist).filter(a => !query || a.name.toLowerCase().includes(query));
    }

    let browseData = null;
    if (isBrowse){
      if (currentView.mode !== 'year' && currentView.mode !== 'genre') currentView.mode = 'year';
      browseData = (currentView.mode === 'year' ? getYears() : getGenres())
        .filter(g => !query || g.name.toLowerCase().includes(query));
    }

    const baseIndices = activePlaylist
      ? activePlaylist.trackIds.map(id => playlist.findIndex(t => t.id === id)).filter(i => i !== -1)
      : (isAlbum
          ? playlist.map((t, i) => ({ t, i }))
              .filter(({ t }) => t.kind !== 'video' && (t.artist || 'Unknown Artist') === currentView.artist && (t.album || 'Unknown Album') === currentView.album)
              .map(({ i }) => i)
          : (isBrowseGroup
              ? playlist.map((t, i) => ({ t, i }))
                  .filter(({ t }) => t.kind !== 'video' && (currentView.mode === 'year'
                    ? ((t.year || '').toString().trim() || 'Unknown Year')
                    : ((t.genre || '').trim() || 'Unknown Genre')) === currentView.value)
                  .map(({ i }) => i)
              : playlist.map((_, i) => i)));

    const visible = baseIndices
      .map(i => ({ t: playlist[i], i }))
      .filter(({ t }) => matchesTrackQuery(t, query));

    // A new tab, search, or library change starts pagination on its first page.
    const nextPaginationViewKey = JSON.stringify({
      view: currentView,
      query,
      ids: visible.map(({ t }) => t.id)
    });
    if (nextPaginationViewKey !== paginationViewKey) {
      paginationViewKey = nextPaginationViewKey;
      currentPage = 1;
    }

    // Back-link (breadcrumb) above the grid for the nested artist/album/browse views.
    if (isArtistAlbums){
      viewBackBtn.style.display = 'inline-flex';
      viewBackBtnLabel.textContent = 'All artists';
      viewBackBtn.onclick = () => { currentView = { type: 'artists' }; scheduleRender(searchInput.value); };
    } else if (isAlbum){
      viewBackBtn.style.display = 'inline-flex';
      viewBackBtnLabel.textContent = currentView.artist;
      viewBackBtn.onclick = () => { currentView = { type: 'artistAlbums', artist: currentView.artist }; scheduleRender(searchInput.value); };
    } else if (isBrowseGroup){
      viewBackBtn.style.display = 'inline-flex';
      viewBackBtnLabel.textContent = currentView.mode === 'year' ? 'All years' : 'All genres';
      viewBackBtn.onclick = () => { currentView = { type: 'browse', mode: currentView.mode }; scheduleRender(searchInput.value); };
    } else {
      viewBackBtn.style.display = 'none';
      viewBackBtn.onclick = null;
    }

    // Filter-by switch, only shown on the top-level browse page.
    browseSwitch.style.display = isBrowse ? 'inline-flex' : 'none';
    if (isBrowse){
      browseSwitchYear.classList.toggle('active', currentView.mode === 'year');
      browseSwitchGenre.classList.toggle('active', currentView.mode === 'genre');
    }

    if (isArtists){
      greeting.textContent = 'Artists';
    } else if (isArtistAlbums){
      greeting.textContent = currentView.artist;
    } else if (isAlbum){
      greeting.textContent = currentView.album;
    } else if (isBrowse){
      greeting.textContent = 'Browse';
    } else if (isBrowseGroup){
      greeting.textContent = currentView.value;
    } else {
      greeting.textContent = activePlaylist ? activePlaylist.name : 'Your shelf';
    }

    const hasAnyInView = isArtists ? artistsData.length > 0
      : isArtistAlbums ? albumsData.length > 0
      : isBrowse ? browseData.length > 0
      : baseIndices.length > 0;

    const useDetailedAlbum = isAlbum && settings.detailedAlbumView && baseIndices.length > 0;

    greeting.style.display = useDetailedAlbum ? 'none' : '';
    subhead.style.display = useDetailedAlbum ? 'none' : '';
    albumDetail.style.display = useDetailedAlbum ? 'flex' : 'none';
    emptyMain.style.display = useDetailedAlbum ? 'none' : (hasAnyInView ? 'none' : 'block');
    cardGrid.style.display = useDetailedAlbum ? 'none' : (hasAnyInView ? 'grid' : 'none');

    if (isArtists){
      subhead.textContent = artistsData.length
        ? `${artistsData.length} artist${artistsData.length === 1 ? '' : 's'} in your library`
        : 'Artist names are read automatically from your files\u2019 tags';
    } else if (isArtistAlbums){
      subhead.textContent = albumsData.length
        ? `${albumsData.length} album${albumsData.length === 1 ? '' : 's'} by ${currentView.artist}`
        : `No albums found for ${currentView.artist}`;
    } else if (isAlbum){
      subhead.textContent = `${baseIndices.length} track${baseIndices.length === 1 ? '' : 's'} \u2022 ${currentView.artist}`;
    } else if (isBrowse){
      const label = currentView.mode === 'year' ? 'year' : 'genre';
      subhead.textContent = browseData.length
        ? `${browseData.length} ${label}${browseData.length === 1 ? '' : 's'} found in your library`
        : `No ${label} tags found yet \u2014 most MP3s already include this in their metadata`;
    } else if (isBrowseGroup){
      subhead.textContent = `${baseIndices.length} track${baseIndices.length === 1 ? '' : 's'}`;
    } else {
      subhead.textContent = hasAnyInView
        ? `${baseIndices.length} item${baseIndices.length === 1 ? '' : 's'}${activePlaylist ? ' in this playlist' : ' on your shelf'}`
        : (activePlaylist ? 'This playlist is empty — use the + button on any track to add it here.' : 'Add audio or video files from your computer to start playing');
    }

    if (isArtists){
      emptyMain.querySelector('h3').textContent = 'No artists found yet';
      emptyMain.querySelector('p').textContent = 'Add some music with artist tags — most MP3s already have them — and they\u2019ll show up here automatically.';
    } else if (isArtistAlbums){
      emptyMain.querySelector('h3').textContent = 'No albums found';
      emptyMain.querySelector('p').textContent = `None of ${currentView.artist}'s tracks have an album tag yet.`;
    } else if (isBrowse){
      emptyMain.querySelector('h3').textContent = currentView.mode === 'year' ? 'No years found yet' : 'No genres found yet';
      emptyMain.querySelector('p').textContent = 'Add some music with year/genre tags — most MP3s already have them — and they\u2019ll show up here automatically.';
    } else {
      emptyMain.querySelector('h3').textContent = activePlaylist ? 'This playlist is empty' : 'Nothing on the shelf yet';
      emptyMain.querySelector('p').textContent = activePlaylist
        ? 'Add tracks to this playlist using the + button that appears on any track in your library.'
        : 'Almost any audio or video file works — MP3, WAV, FLAC, AAC, M4A, OGG, MP4, WebM, MOV, and more. Everything you add is saved in this browser automatically.';
    }
    emptyMain.querySelector('.add-btn').style.display = (activePlaylist || isArtistAlbums || isAlbum || isBrowse || isBrowseGroup) ? 'none' : 'inline-flex';

    if (!skipSidebar) {
    trackListSidebar.innerHTML = '';

    if (baseIndices.length === 0){
      const d = document.createElement('div');
      d.className = 'empty-shelf';
      d.textContent = activePlaylist ? 'No tracks in this playlist yet.' : 'Nothing added yet.';
      trackListSidebar.appendChild(d);
    } else if (visible.length === 0){
      const d = document.createElement('div');
      d.className = 'empty-shelf';
      d.textContent = 'No matches.';
      trackListSidebar.appendChild(d);
    } else {
      visible.forEach(({ t, i }, visIdx) => {
        const item = document.createElement('div');
        item.className = 'track-item' + (i === currentIndex ? ' active' : '');
        item.dataset.trackId = t.id;
        const inPlaylist = !!activePlaylist;
        let sub = t.kind === 'video' ? 'Video' : (t.kind === 'flac' ? 'FLAC' : 'Track ' + (i + 1));
        if (t.loading) sub = 'Decoding…';
        if (t.error) sub = 'Could not play this file';
        const handleHtml = inPlaylist
          ? `<span class="drag-handle" title="Drag to reorder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg></span>`
          : '';
        const albumArtEntry = albumArtForTrack(t);
        const thumbHtml = t.thumbUrl
          ? `${t.thumbKind === 'video' ? `<video src="${t.thumbUrl}" muted loop autoplay playsinline preload="metadata"></video>` : `<img src="${t.thumbUrl}" loading="lazy" decoding="async" alt="">`}`
          : (albumArtEntry ? albumArtMarkup(albumArtEntry, t.title) : iconFor(t.kind));
        const isSelRow = selectedTrackIds.has(t.id);
        if (isSelRow) item.classList.add('batch-selected');
        item.innerHTML = `
          ${handleHtml}
          <label class="track-select-check" title="Select track" onclick="event.stopPropagation()">
            <input type="checkbox" class="track-select-input"${isSelRow ? ' checked' : ''}>
          </label>
          <div class="track-thumb" title="Set thumbnail">${thumbHtml}</div>
          <div class="track-meta">
            <div class="track-title" title="Double-click to rename">${escapeHtml(t.title)}</div>
            <div class="track-sub">${sub}</div>
          </div>
          <button class="track-row-more" type="button" title="More options">…</button>
          `;
        item.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey || e.target.closest('.track-select-check')){
            e.preventDefault();
            const visibleItems = Array.from(trackListSidebar.querySelectorAll('.track-item[data-track-id]'));
            const visibleIds   = visibleItems.map(el => parseInt(el.dataset.trackId, 10));
            const clickedVis   = visibleItems.indexOf(item);
            toggleTrackSelected(t.id, e.shiftKey, clickedVis, visibleIds);
            const chk = item.querySelector('.track-select-input');
            if (chk) chk.checked = selectedTrackIds.has(t.id);
            item.classList.toggle('batch-selected', selectedTrackIds.has(t.id));
            return;
          }
          if (e.target.closest('.track-select-check')) return;
          playTrackAt(i, true);
        });
        item.querySelector('.track-thumb').addEventListener('click', (e) => {
          if (e.target.closest('.track-thumb-clear')) return;
          e.stopPropagation();
          openThumbPicker(t.id);
        });
        const titleEl = item.querySelector('.track-title');
        titleEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startInlineRename(titleEl, t);
        });
        const rowMore = item.querySelector('.track-row-more');
        if (rowMore) rowMore.addEventListener('click', (e) => { e.stopPropagation(); openTrackActions(t.id, e.currentTarget); });
        item.addEventListener('contextmenu', (e) => { e.preventDefault(); openTrackActions(t.id, e.currentTarget); });
        item.draggable = true; item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(t.id)); });
        if (inPlaylist){
          const handle = item.querySelector('.drag-handle');
          handle.addEventListener('click', (e) => e.stopPropagation());
          setupReorderHandle(handle, item, trackListSidebar, 'list', t.id, activePlaylist);
        }
        trackListSidebar.appendChild(item);
      });
    }
    }

    cardGrid.innerHTML = '';
    albumDetail.innerHTML = '';

    if (!isBrowse){
      cardGrid.classList.remove('browse-grid');
      if (settings.view === 'grid' || settings.view === 'shelf'){
        cardGrid.style.gridTemplateColumns = settings.view === 'shelf'
          ? ''
          : `repeat(auto-fill, minmax(${settings.cardSize}px, 1fr))`;
      }
      cardGrid.style.gap = `${settings.cardGap}px`;
    }

    // Track whether the page currently on screen is even one that uses
    // the virtualized flat track-card grid (home/playlist/album/browseGroup)
    // — Artists, Browse's own top-level list, and album/artist detail
    // pages never go through that path, so scroll on those pages should
    // never trigger a virtualization re-render at all.
    const isFlatTrackView = !useDetailedAlbum && !isArtists && !isArtistAlbums && !isBrowse;

    // Home can optionally be organized into sections (by album, date
    // added, artist, or genre) instead of one flat list. Grouped mode
    // shows every section inline on one page, so it bypasses pagination
    // and virtualization (both assume one uniform flat sequence of cards,
    // which section headers break) and just renders everything directly.
    const isGroupedHome = isFlatTrackView && currentView.type === 'home' && !activePlaylist
      && settings.homeGrouping && settings.homeGrouping !== 'none';

    // Whichever list this render will actually build cards from gets
    // paginated down to ITEMS_PER_PAGE *before* any DOM is built. Since a
    // page is always well under the virtualization threshold, windowed
    // scrolling naturally stays dormant within a single page — the two
    // systems no longer fight over the same cards.
    let paginationSource = null;
    if (isArtists) paginationSource = artistsData;
    else if (isArtistAlbums) paginationSource = albumsData;
    else if (isBrowse) paginationSource = browseData;
    else if (isFlatTrackView && !isGroupedHome) paginationSource = visible;
    const pagedItems = paginationSource ? pageItems(paginationSource) : null;

    lastRenderIsVirtualizable = isFlatTrackView && !isGroupedHome;
    lastRenderVisibleCount = (isFlatTrackView && !isGroupedHome && pagedItems) ? pagedItems.length : 0;

    // Builds one track card — used by the normal flat/virtualized list and
    // by grouped Home sections alike, so thumbnails, queueing, lyrics,
    // rename, drag-reorder etc. behave identically either way. When
    // queueContextIds is given (a specific group's track ids), clicking
    // the card queues just that group instead of the whole view.
    function buildFlatTrackCard(t, i, inPlaylist, queueContextIds){
      const card = document.createElement('div');
      card.className = 'card virtual-track-card' + (i === currentIndex ? ' active' : '');
      card.dataset.trackId = t.id;
      let statusHtml = '';
      if (t.loading) statusHtml = '<div class="card-loading">Decoding…</div>';
      else if (t.error) statusHtml = '<div class="card-error">Format not supported by this browser</div>';
      const cardHandleHtml = inPlaylist
        ? `<button class="card-drag-handle" type="button" title="Drag to reorder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg></button>`
        : '';
      const albumArtEntry = albumArtForTrack(t);
      const cardArtInner = t.thumbUrl
        ? (t.thumbKind === 'video' ? `<video src="${t.thumbUrl}" muted loop autoplay playsinline preload="metadata"></video>` : `<img src="${t.thumbUrl}" loading="lazy" decoding="async" alt="">`)
        : (albumArtEntry ? albumArtMarkup(albumArtEntry, t.title) : iconFor(t.kind));
      const thumbClearHtml = t.thumbUrl
        ? `<button class="card-thumb-clear-btn" type="button" title="Remove thumbnail">&times;</button>`
        : '';
      const isSelected = selectedTrackIds.has(t.id);
      if (isSelected) card.classList.add('batch-selected');
      card.innerHTML = `
        <div class="card-art">
          ${cardArtInner}
          <div class="card-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
        </div>
        <label class="card-select-check" title="Select track" onclick="event.stopPropagation()">
          <input type="checkbox" class="card-select-input"${isSelected ? ' checked' : ''}>
        </label>
        ${cardHandleHtml}
        <button class="card-add-btn" type="button" title="Add to playlist">+</button>
        <button class="queue-add-btn" type="button" title="Add to queue">☷</button>
        <button class="track-more-btn" type="button" title="More options">…</button>
        <button class="card-lyrics-btn${t.lyrics ? ' has-lyrics' : ''}" type="button" title="Lyrics"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h7"/></svg></button>
        <button class="card-thumb-btn" type="button" title="Set thumbnail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
        ${thumbClearHtml}
        <div class="card-title" title="Double-click to rename">${escapeHtml(t.title)}</div>
        <div class="card-sub">${t.kind === 'video' ? 'Video' : (t.kind === 'flac' ? 'FLAC audio' : 'Audio')}</div>
        ${statusHtml}
      `;
      // Ctrl/Cmd+click or checkbox toggles selection; plain click plays
      card.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.target.closest('.card-select-check')){
          e.preventDefault();
          // Gather visible track IDs for shift-select range
          const visibleCards = Array.from(cardGrid.querySelectorAll('.card[data-track-id]'));
          const visibleIds   = visibleCards.map(c => parseInt(c.dataset.trackId, 10));
          const clickedVis   = visibleCards.indexOf(card);
          toggleTrackSelected(t.id, e.shiftKey, clickedVis, visibleIds);
          // Update this card's checkbox
          const chk = card.querySelector('.card-select-input');
          if (chk) chk.checked = selectedTrackIds.has(t.id);
          card.classList.toggle('batch-selected', selectedTrackIds.has(t.id));
          return;
        }
        if (e.target.closest('.card-select-check')) return;
        playTrackAt(i, true, queueContextIds);
      });
      card.querySelector('.card-add-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openPlaylistMenu(t.id, e.currentTarget);
      });
      card.querySelector('.queue-add-btn').addEventListener('click', (e) => { e.stopPropagation(); queueTrack(t.id); openQueue(); });
      card.querySelector('.track-more-btn').addEventListener('click', (e) => { e.stopPropagation(); openTrackActions(t.id, e.currentTarget); });
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); openTrackActions(t.id, e.currentTarget); });
      card.draggable = true; card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(t.id)); });
      card.querySelector('.card-lyrics-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openLyricsEditor(t.id);
      });
      card.querySelector('.card-thumb-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openThumbPicker(t.id);
      });
      const clearBtn = card.querySelector('.card-thumb-clear-btn');
      if (clearBtn) clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearTrackThumb(t.id);
      });
      const cardTitleEl = card.querySelector('.card-title');
      cardTitleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startInlineRename(cardTitleEl, t);
      });
      if (inPlaylist){
        const handle = card.querySelector('.card-drag-handle');
        handle.addEventListener('click', (e) => e.stopPropagation());
        setupReorderHandle(handle, card, cardGrid, 'grid', t.id, activePlaylist);
      }
      return card;
    }

    // Buckets `visible` into named, sorted sections for grouped Home view.
    function groupVisibleForHome(entries, mode){
      const groups = new Map();
      function bucketName(t){
        if (mode === 'album') return (t.album || '').trim() || 'Unknown Album';
        if (mode === 'artist') return (t.artist || '').trim() || 'Unknown Artist';
        if (mode === 'genre') return (t.genre || '').trim() || 'Unknown Genre';
        if (mode === 'date'){
          if (!t.addedAt) return 'Unknown Date';
          return new Date(t.addedAt).toLocaleString(undefined, { month: 'long', year: 'numeric' });
        }
        return '';
      }
      entries.forEach(entry => {
        const name = bucketName(entry.t);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(entry);
      });
      let out = Array.from(groups.entries()).map(([name, items]) => ({ name, items }));
      const unknownNames = ['Unknown Album', 'Unknown Artist', 'Unknown Genre', 'Unknown Date'];
      if (mode === 'date'){
        out.sort((a, b) => {
          const aMax = Math.max(...a.items.map(e => e.t.addedAt || 0));
          const bMax = Math.max(...b.items.map(e => e.t.addedAt || 0));
          return bMax - aMax;
        });
        out.forEach(g => g.items.sort((a, b) => (b.t.addedAt || 0) - (a.t.addedAt || 0)));
      } else {
        out.sort((a, b) => {
          if (unknownNames.includes(a.name)) return 1;
          if (unknownNames.includes(b.name)) return -1;
          return a.name.localeCompare(b.name);
        });
        if (mode === 'album'){
          out.forEach(g => g.items.sort((a, b) =>
            (a.t.trackNum || Number.MAX_SAFE_INTEGER) - (b.t.trackNum || Number.MAX_SAFE_INTEGER) || a.t.title.localeCompare(b.t.title)));
        }
      }
      return out;
    }

    if (useDetailedAlbum){
      renderAlbumDetail(currentView.artist, currentView.album, visible);
    } else if (isArtists){
      pagedItems.forEach(({ name, tracks }) => {
        const entry = artistThumbs.get(name);
        const thumbUrl = entry ? entry.url : null;
        const card = document.createElement('div');
        card.className = 'card artist-card';
        const cardArtInner = thumbUrl ? `<img src="${thumbUrl}" loading="lazy" decoding="async" alt="">` : PERSON_ICON;
        const thumbClearHtml = thumbUrl
          ? `<button class="card-thumb-clear-btn" type="button" title="Remove thumbnail">&times;</button>`
          : '';
        card.innerHTML = `
          <div class="card-art card-art-round">${cardArtInner}</div>
          <button class="card-thumb-btn" type="button" title="Set artist thumbnail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
          ${thumbClearHtml}
          <div class="card-title">${escapeHtml(name)}</div>
          <div class="card-sub">${tracks.length} track${tracks.length === 1 ? '' : 's'}</div>
        `;
        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-thumb-btn') || e.target.closest('.card-thumb-clear-btn')) return;
          currentView = { type: 'artistAlbums', artist: name };
          scheduleRender();
        });
        card.querySelector('.card-thumb-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          openArtistThumbPicker(name);
        });
        const artistClearBtn = card.querySelector('.card-thumb-clear-btn');
        if (artistClearBtn) artistClearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          clearArtistThumb(name);
        });
        cardGrid.appendChild(card);
      });
    } else if (isArtistAlbums){
      pagedItems.forEach(({ name, tracks }) => {
        const key = albumKey(currentView.artist, name);
        const entry = albumThumbs.get(key);
        const thumbUrl = entry ? entry.url : null;
        const card = document.createElement('div');
        card.className = 'card';
        const cardArtInner = albumArtMarkup(entry, name);
        const thumbClearHtml = thumbUrl
          ? `<button class="card-thumb-clear-btn" type="button" title="Remove thumbnail">&times;</button>`
          : '';
        card.innerHTML = `
          <div class="card-art">${cardArtInner}</div>
          <button class="card-thumb-btn" type="button" title="Set album thumbnail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
          ${thumbClearHtml}
          <div class="card-title">${escapeHtml(name)}</div>
          <div class="card-sub">${tracks.length} track${tracks.length === 1 ? '' : 's'}</div>
        `;
        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-thumb-btn') || e.target.closest('.card-thumb-clear-btn')) return;
          currentView = { type: 'album', artist: currentView.artist, album: name };
          scheduleRender();
        });
        card.querySelector('.card-thumb-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          openAlbumThumbPicker(key);
        });
        const albumClearBtn = card.querySelector('.card-thumb-clear-btn');
        if (albumClearBtn) albumClearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          clearAlbumThumb(key);
        });
        cardGrid.appendChild(card);
      });
    } else if (isBrowse){
      cardGrid.classList.add('browse-grid');
      cardGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
      cardGrid.style.gap = '10px';
      const icon = currentView.mode === 'year' ? CALENDAR_ICON : GENRE_ICON;
      pagedItems.forEach(({ name, tracks }) => {
        const card = document.createElement('div');
        card.className = 'browse-card';
        card.innerHTML = `
          <div class="browse-card-icon">${icon}</div>
          <div class="browse-card-text">
            <div class="browse-card-title">${escapeHtml(name)}</div>
            <div class="browse-card-sub">${tracks.length} track${tracks.length === 1 ? '' : 's'}</div>
          </div>
        `;
        card.addEventListener('click', () => {
          currentView = { type: 'browseGroup', mode: currentView.mode, value: name };
          scheduleRender();
        });
        cardGrid.appendChild(card);
      });
    } else if (isGroupedHome){
      cardGrid.classList.remove('virtual-track-grid');
      cardGrid.style.paddingTop = '';
      cardGrid.style.paddingBottom = '';
      virtualLastWindowStart = -1;
      virtualLastWindowEnd = -1;
      virtualLastMode = '';
      const sections = groupVisibleForHome(visible, settings.homeGrouping);
      sections.forEach(section => {
        const header = document.createElement('div');
        header.className = 'card-grid-section-header';
        header.innerHTML = `<span>${escapeHtml(section.name)}</span><span class="card-grid-section-count">${section.items.length} song${section.items.length === 1 ? '' : 's'}</span>`;
        cardGrid.appendChild(header);
        const groupIds = section.items.map(({ t }) => t.id);
        section.items.forEach(({ t, i }) => {
          cardGrid.appendChild(buildFlatTrackCard(t, i, false, groupIds));
        });
      });
    } else {
    const virtual = getVirtualWindow(pagedItems.length, 220, settings.cardGap);
    cardGrid.classList.toggle('virtual-track-grid', virtual.enabled);
    cardGrid.classList.toggle('no-entrance-anim', skipSidebar);
    if (virtual.enabled) {
      cardGrid.style.paddingTop = `${virtual.before * virtual.rowSpan}px`;
      cardGrid.style.paddingBottom = `${virtual.after * virtual.rowSpan}px`;
      virtualLastWindowStart = virtual.start;
      virtualLastWindowEnd = virtual.end;
      virtualLastMode = `${currentView.type}|${settings.view}|${settings.cardSize}|${settings.cardGap}`;
    } else {
      cardGrid.style.paddingTop = '';
      cardGrid.style.paddingBottom = '';
      virtualLastWindowStart = -1;
      virtualLastWindowEnd = -1;
      virtualLastMode = '';
    }
    const renderVisible = virtual.enabled ? pagedItems.slice(virtual.start, virtual.end) : pagedItems;
    renderVisible.forEach(({ t, i }) => {
      cardGrid.appendChild(buildFlatTrackCard(t, i, !!activePlaylist));
    });
    }

    renderPlaylistList();
    if (typeof window.updatePaginationControls === 'function') {
      window.updatePaginationControls(paginationSource ? paginationSource.length : 0);
    }
  }

  let searchDebounceTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => scheduleRender(searchInput.value), 70);
  });

  function setPlayingUI(isPlaying){
    playIcon.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
    disc.classList.toggle('spinning', isPlaying);
    stageDisc.classList.toggle('spinning', isPlaying);
    if (lyricsSyncPlayIcon) lyricsSyncPlayIcon.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
  }

  function updateTimeDisplay(cur, dur){
    if (!seeking){
      seekBar.max = dur || 0;
      seekBar.value = cur || 0;
      curTimeEl.textContent = formatTime(cur);
      durTimeEl.textContent = formatTime(dur);
      setRangeProgress(seekBar);
    }
    updateLyricsHighlight(cur);
    if (lyricsModal.classList.contains('open') && lyricsSyncPane.style.display !== 'none'){
      lyricsSyncTime.textContent = formatTime(cur);
    }
  }

  function setRangeProgress(el){
    const max = parseFloat(el.max) || 0;
    const pct = max > 0 ? (parseFloat(el.value) / max) * 100 : 0;
    el.style.setProperty('--range-progress', `${pct}%`);
  }

  function formatTime(sec){
    if (!isFinite(sec) || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  function stopEverything(){
    stopStemPlayback();
    if (currentEngine === 'wasm') wasmPause();
    else { try{ mediaEl.pause(); }catch(e){} }
    setPlayingUI(false);
  }

  function updateNowPlayingText(track, index){
    npTitle.textContent = track.title;
    npSub.textContent = `${index + 1} of ${playlist.length}`;
    stageTitle.textContent = track.title;
    stageSub.textContent = `${index + 1} of ${playlist.length}`;
    stageBadge.style.display = 'inline-block';
    stageBadge.textContent = track.kind === 'video' ? 'Video' : (track.kind === 'flac' ? 'FLAC · decoded in-browser' : 'Audio');
    updateNowPlayingArt(track);
    updateLyricsToggleVisibility();
    if (lyricsPanelOpen) renderLyricsPanel();
    savePlaybackState();
  }

  function updateNowPlayingArt(track){
    const albumArtEntry = albumArtForTrack(track);
    const effectiveUrl = (track && track.thumbUrl) ? track.thumbUrl : (albumArtEntry ? albumArtEntry.url : '');
    const useThumb = !!(settings.nowPlayingThumb && track && track.kind !== 'video' && effectiveUrl);
    const isVideoThumb = useThumb && ((track.thumbUrl && track.thumbKind === 'video') || (!track.thumbUrl && albumArtEntry && albumArtEntry.kind === 'video'));
    npArt.classList.toggle('has-thumb', useThumb && !isVideoThumb);
    npArt.classList.toggle('has-thumb-video', isVideoThumb);
    stageVisual.classList.toggle('has-thumb', useThumb && !isVideoThumb);
    stageVisual.classList.toggle('has-thumb-video', isVideoThumb);
    stageThumb.src = useThumb && !isVideoThumb ? effectiveUrl : '';
    npThumb.src = useThumb && !isVideoThumb ? effectiveUrl : '';
    const videoUrl = isVideoThumb ? effectiveUrl : '';
    if (stageThumbVideo.src !== videoUrl){ stageThumbVideo.src = videoUrl; }
    if (npThumbVideo.src !== videoUrl){ npThumbVideo.src = videoUrl; }
    if (isVideoThumb){ stageThumbVideo.play().catch(() => {}); npThumbVideo.play().catch(() => {}); }
    else { stageThumbVideo.pause(); npThumbVideo.pause(); }
  }

  function restoreMediaAudio(){
    const volume = Math.max(0, Math.min(1, parseFloat(volBar.value)));
    mediaEl.volume = mediaSourceNode ? 1 : (Number.isFinite(volume) ? volume : 1);
    mediaEl.defaultMuted = false;
    mediaEl.muted = mediaEl.volume === 0;
  }

 async function loadTrack(index, autoplay){
  if (index < 0 || index >= playlist.length) return;

  stopEverything();
  stopStemPlayback();

  currentIndex = index;
    currentIndex = index;
    const track = playlist[index];
    // Once a manually-queued ("Add to queue") track actually starts
    // playing, it's done its job — drop it so it doesn't keep reappearing
    // in the queue every time the order gets recomputed.
    if (manualQueueIds.includes(track.id)) manualQueueIds = manualQueueIds.filter(id => id !== track.id);
    markPlayed(track);
    renderQueue();
    const isVideo = track.kind === 'video';
    stagePanel.classList.remove('stage-closed');
    stagePanel.classList.toggle('has-video', isVideo);
    mediaEl.controls = isVideo;
    restoreMediaAudio();
    videoPipBtn.style.display = isVideo ? 'inline-block' : 'none';
    updateNowPlayingText(track, index);
    savePlaybackState();
    scheduleRender(searchInput.value);

    // Auto-fetch lyrics if missing (non-blocking)
    autoFetchLyrics(track);

    if (track.kind === 'flac'){
      // If this FLAC has already been converted+split before, load the
      // saved stems instead of falling back to raw wasm playback. This
      // check previously lived further down inside the "else" branch of
      // this very if-statement, so it could never actually run for a
      // FLAC track and the stem mixer never came back after reopening
      // the app on a FLAC file that had already been split.
      if (!track.stems && track.sourcePath) {
        try {
          track.stems = await window.electronAPI.findExistingStemsForSource(track.sourcePath) || null;
          if (track.stems) dbPut(track);
        } catch (e) {}
      }

      if (track.stems) {
        const stemsOk = await window.electronAPI.verifyStems(track.stems);
        if (!stemsOk) {
          track.stems = null;
          dbPut(track);
        }
      }

      if (track.stems) {
        const loaded = await loadStemTrack(track);
        if (loaded) {
          if (autoplay) await playStems();
          return;
        }
      }

      currentEngine = 'wasm';
      stagePanel.classList.remove('has-video');
      stageVisual.classList.remove('has-video');
      try{ mediaEl.pause(); mediaEl.removeAttribute('src'); mediaEl.load(); }catch(e){}

      if (track.wasmBuffer){
        wasmBuffer = track.wasmBuffer;
        wasmOffset = 0;
        updateTimeDisplay(0, wasmBuffer.duration);
        if (autoplay) wasmPlay(0);
        return;
      }

      track.loading = true;
      pendingAutoplayId = autoplay ? track.id : null;
      scheduleRender(searchInput.value);
      try{
        const buffer = await decodeFlacTrack(track);
        track.wasmBuffer = buffer;
        track.loading = false;
        if (currentIndex === index){
          wasmBuffer = buffer;
          wasmOffset = 0;
          updateTimeDisplay(0, buffer.duration);
          if (pendingAutoplayId === track.id) wasmPlay(0);
        }
      } catch(err){
        track.loading = false;
        track.error = true;
        if (currentIndex === index) stageSub.textContent = 'This FLAC file could not be decoded';
      }
      scheduleRender(searchInput.value);
    } else {

  if (!track.stems && track.sourcePath) {
  try {
    // track.kind is never 'flac' here — FLAC tracks are handled entirely
    // in the `if (track.kind === 'flac')` branch above.
    track.stems =
      await window.electronAPI.findExistingStems(track.sourcePath) || null;

    if (track.stems) dbPut(track);
  } catch (e) {}
}

  if (track.stems) {
    const stemsOk = await window.electronAPI.verifyStems(track.stems);
    if (!stemsOk) {
      track.stems = null;
      dbPut(track);
    }
  }

  if (track.stems) {
    const loaded = await loadStemTrack(track);

    if (loaded) {
      if (autoplay) {
        await playStems();
      }

      return;
    }
  }

  currentEngine = 'media';
      // Reset the media element before assigning the new object URL. This
      // prevents a previous source/load state from swallowing the first play.
      try{ mediaEl.pause(); mediaEl.removeAttribute('src'); mediaEl.load(); }catch(e){}
      mediaEl.src = track.url;
      mediaEl.load();
      try{
        const ctx = getCtx();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      }catch(e){}
      wireMediaElement();
      mediaEl.playbackRate = currentSpeed;
      restoreMediaAudio();
      if (autoplay){
        const playPromise = mediaEl.play();
        if (playPromise && typeof playPromise.catch === 'function'){
          playPromise.catch(() => {
            track.error = true;
            npSub.textContent = 'This file format could not be played in your browser';
            scheduleRender(searchInput.value);
          });
        }
      }
    }
  }

  mediaEl.addEventListener('loadedmetadata', () => {
    restoreMediaAudio();
    stageVisual.classList.toggle('has-video', mediaEl.videoWidth > 0);
    stagePanel.classList.toggle('has-video', mediaEl.videoWidth > 0);
    videoPipBtn.style.display = mediaEl.videoWidth > 0 ? 'inline-block' : 'none';
    updateTimeDisplay(mediaEl.currentTime, mediaEl.duration);
    savePlaybackState();
  });
  mediaEl.addEventListener('timeupdate', () => {
    updateTimeDisplay(mediaEl.currentTime, mediaEl.duration);
    savePlaybackState();
  });
  mediaEl.addEventListener('play', () => { restoreMediaAudio(); setPlayingUI(true); savePlaybackState(); });
  mediaEl.addEventListener('pause', () => { setPlayingUI(false); savePlaybackState(); });
  mediaEl.addEventListener('ended', () => { if (settings.autoplayNext) playNext(); else setPlayingUI(false); savePlaybackState(); });

  // ---------- Fullscreen for music videos ----------
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const ICON_EXPAND = '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>';
  const ICON_COMPRESS = '<path d="M9 3v3a2 2 0 0 1-2 2H4M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>';

  function isFullscreen(){
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }
  function enterFullscreen(){
    const req = stageVisual.requestFullscreen || stageVisual.webkitRequestFullscreen || stageVisual.msRequestFullscreen;
    if (req){ req.call(stageVisual).catch(() => {}); }
    else if (mediaEl.webkitEnterFullscreen){ mediaEl.webkitEnterFullscreen(); }
  }
  function exitFullscreen(){
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
  }
  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isFullscreen()) exitFullscreen(); else enterFullscreen();
  });
  stageVisual.addEventListener('dblclick', () => {
    if (!stageVisual.classList.contains('has-video')) return;
    if (isFullscreen()) exitFullscreen(); else enterFullscreen();
  });
  ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(evt => {
    document.addEventListener(evt, () => {
      const fs = isFullscreen();
      mediaEl.controls = fs;
      fullscreenBtn.innerHTML = fs ? ICON_COMPRESS : ICON_EXPAND;
      fullscreenBtn.title = fs ? 'Exit fullscreen' : 'Fullscreen';
    });
  });

  mediaEl.addEventListener('error', () => {
    if (currentIndex !== -1 && currentEngine === 'media'){
      playlist[currentIndex].error = true;
      npSub.textContent = 'This file format could not be played in your browser';
      scheduleRender(searchInput.value);
    }
  });

  playBtn.addEventListener('click', () => {
    if (currentIndex === -1){
      const viewQueue = computeQueueForView();
      const order = viewQueue
        ? viewQueue.map(id => playlist.findIndex(t => t.id === id)).filter(i => i !== -1)
        : playlist.map((_, i) => i);
      if (order.length > 0) playTrackAt(order[0], true);
      return;
    }
    const track = playlist[currentIndex];
    if (currentEngine === 'wasm'){
      if (!wasmBuffer){ pendingAutoplayId = track.id; return; }
      if (wasmPlaying) wasmPause(); else wasmPlay(wasmOffset);
   } else if (currentEngine === 'stems') {

  const stemPaused = stemAudio.drums.paused;

  if (stemPaused) {
    playStems();
  } else {
    pauseStems();
  }

} else {

  if (mediaEl.paused){
    mediaEl.play().catch(() => {
      track.error = true;
      scheduleRender(searchInput.value);
    });
  } else {
    mediaEl.pause();
  }
}
    savePlaybackState();
  });

  // The full track-id list for whatever context you're currently viewing
  // (playlist/album/browse group/home/etc). currentViewTrackIds() already
  // implements this per-view logic and falls back to the whole library —
  // this used to duplicate that logic with a narrower set of view types
  // and a `null` fallback, which is why clicking a track outside a
  // playlist/album/browseGroup never properly reset the queue.
  function computeQueueForView(){
    const ids = currentViewTrackIds();
    return (ids && ids.length) ? ids : null;
  }

  // Returns the full playback order as an array of playlist indices.
  // The "context" queue (queueIds — whatever playlist/album/group you
  // started playing from) provides the base sequence; any manually
  // queued tracks (manualQueueIds — from "Add to queue") get spliced in
  // right after wherever the currently-playing track sits, so they play
  // next without disturbing — or being wiped out by — the context.
  function getQueueOrder(){
    let contextIds = queueIds.filter(id => playlist.some(t => t.id === id));
    if (!contextIds.length){
      const viewQueue = computeQueueForView();
      contextIds = (viewQueue && viewQueue.length) ? viewQueue.slice() : playlist.map(t => t.id);
      queueIds = contextIds.slice();
      activeQueueIds = contextIds.slice();
    }

    const validManualIds = manualQueueIds.filter(id => playlist.some(t => t.id === id));
    if (validManualIds.length !== manualQueueIds.length) manualQueueIds = validManualIds;
    if (!validManualIds.length){
      return contextIds.map(id => playlist.findIndex(t => t.id === id)).filter(i => i !== -1);
    }

    const currentId = currentIndex >= 0 && playlist[currentIndex] ? playlist[currentIndex].id : null;
    const currentPos = currentId ? contextIds.indexOf(currentId) : -1;
    const insertAt = currentPos === -1 ? 0 : currentPos + 1;
    const merged = contextIds.slice(0, insertAt)
      .concat(validManualIds)
      .concat(contextIds.slice(insertAt).filter(id => !validManualIds.includes(id)));

    return merged.map(id => playlist.findIndex(t => t.id === id)).filter(i => i !== -1);
  }

  function playTrackAt(index, autoplay, queueContextIds){
    if (index < 0 || index >= playlist.length) return;

    // The context queue always rebuilds to match wherever this track was
    // clicked from — a playlist, an album, a browse group, a grouped Home
    // section (via the explicit queueContextIds override), or otherwise
    // the current view's full track list. This used to only happen for
    // playlists, or when the queue was already empty, so picking a song
    // from a different album while something was still queued silently
    // kept playing through the old context instead of switching to it.
    const viewIds = (queueContextIds && queueContextIds.length) ? queueContextIds.slice() : computeQueueForView();
    if (viewIds && viewIds.length){
      queueIds = viewIds.slice();
      if (shuffleEnabled) shuffleArray(queueIds);
    } else if (!queueIds.length){
      const ids = currentViewTrackIds();
      queueIds = (ids && ids.length ? ids : playlist.map(t => t.id)).slice();
      if (shuffleEnabled) shuffleArray(queueIds);
    }
    activeQueueIds = queueIds.slice();
    loadTrack(index, autoplay);
    renderQueue();
  }

  function playNext(){
    if (playlist.length === 0) return;
    const order = getQueueOrder();
    const pos = order.indexOf(currentIndex);
    if (repeatMode === 'one' && currentIndex !== -1){ loadTrack(currentIndex, true); return; }
    if (pos === -1){ loadTrack(order[0], true); return; }
    if (pos >= order.length - 1){
      if (repeatMode !== 'all') { setPlayingUI(false); return; }
      loadTrack(order[0], true); return;
    }
    let nextPos = pos + 1;
    loadTrack(order[nextPos], true);
  }
  function playPrev(){
    if (playlist.length === 0) return;
    const wasPlaying =
  currentEngine === 'wasm'
    ? wasmPlaying
    : currentEngine === 'stems'
      ? !stemAudio.drums.paused
      : !mediaEl.paused;
    const order = getQueueOrder();
    const pos = order.indexOf(currentIndex);
    const prevPos = pos === -1 ? 0 : (pos - 1 + order.length) % order.length;
    loadTrack(order[prevPos], wasPlaying);
  }
  prevBtn.addEventListener('click', playPrev);
  nextBtn.addEventListener('click', playNext);

  seekBar.addEventListener('input', () => {
    seeking = true;
    curTimeEl.textContent = formatTime(parseFloat(seekBar.value));
    setRangeProgress(seekBar);
  });
seekBar.addEventListener('change', () => {
  const t = parseFloat(seekBar.value);

  if (currentEngine === 'wasm') {
    wasmSeek(t);
  } else if (currentEngine === 'stems') {
    seekStems(t);
  } else {
    mediaEl.currentTime = t;
  }

  seeking = false;
  savePlaybackState();
});

  const muteBtn = document.getElementById('muteBtn');
  const volIcon = document.getElementById('volIcon');
  const ICON_VOL = '<path d="M11 5 6 9H2v6h4l5 4zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 10 0 0 1 0 7.07"/>';
  const ICON_MUTE = '<path d="M11 5 6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"/>';
  let lastVolume = 1;

  function setVolume(v){
    v = Math.max(0, Math.min(1, v));
    volBar.value = v;
    restoreMediaAudio();
    if (gainNode) rebuildEqGain();
    volIcon.innerHTML = v === 0 ? ICON_MUTE : ICON_VOL;
    setRangeProgress(volBar);
    savePlaybackState();
  }

  volBar.addEventListener('input', () => {
    const v = parseFloat(volBar.value);
    if (v > 0) lastVolume = v;
    setVolume(v);
  });
  setRangeProgress(volBar);

  muteBtn.addEventListener('click', () => {
    if (parseFloat(volBar.value) > 0){
      lastVolume = parseFloat(volBar.value);
      setVolume(0);
    } else {
      setVolume(lastVolume || 1);
    }
  });

  speedSelect.addEventListener('change', () => {
    currentSpeed = parseFloat(speedSelect.value);
    if (currentEngine === 'wasm'){
      if (wasmSource) wasmSource.playbackRate.value = currentSpeed;
      if (wasmPlaying){
        const t = getWasmCurrentTime();
        wasmOffset = t;
        wasmStartCtxTime = getCtx().currentTime;
      }
    } else {
      mediaEl.playbackRate = currentSpeed;
    }
    savePlaybackState();
  });

  function getCurrentTime(){
    return currentEngine === 'wasm' ? getWasmCurrentTime() : mediaEl.currentTime;
  }
  function getDuration(){
    return currentEngine === 'wasm' ? (wasmBuffer ? wasmBuffer.duration : 0) : mediaEl.duration;
  }
  function seekBy(delta){
    if (currentIndex === -1) return;

    const dur = getDuration() || 0;
    const t = Math.max(
      0,
      Math.min(getCurrentTime() + delta, dur)
    );

    if (currentEngine === 'wasm'){
      wasmSeek(t);
    } else if (currentEngine === 'stems'){
      seekStems(t);
    } else {
      mediaEl.currentTime = t;
    }
}

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    const isTyping = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable;

    if (e.key === 'Escape'){
      if (lyricsModal.classList.contains('open')) closeLyricsEditor();
      if (customizeDrawer.classList.contains('open')) closeDrawer();
      closePlaylistMenu();
      closeQueue();
      if (metadataEditorBackdrop.classList.contains('open')) closeMetadataEditor();
      return;
    }

    if (lyricsModal.classList.contains('open') && lyricsSyncPane.style.display !== 'none' && e.code === 'Space' && tag !== 'TEXTAREA'){
      e.preventDefault();
      tagCurrentLine();
      return;
    }

    if (isTyping){
      if (e.key === 'Escape' && document.activeElement === searchInput) searchInput.blur();
      return;
    }

    if (e.code === 'Space'){
      e.preventDefault();
      playBtn.click();
    } else if (e.key === '/'){
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === 'ArrowRight'){
      e.preventDefault();
      seekBy(5);
    } else if (e.key === 'ArrowLeft'){
      e.preventDefault();
      seekBy(-5);
    } else if (e.key === 'ArrowUp'){
      e.preventDefault();
      const v = parseFloat(volBar.value);
      if (v > 0) lastVolume = v;
      setVolume(v + 0.05);
    } else if (e.key === 'ArrowDown'){
      e.preventDefault();
      const v = parseFloat(volBar.value);
      if (v > 0) lastVolume = v;
      setVolume(v - 0.05);
    } else if (e.key.toLowerCase() === 'n'){
      nextBtn.click();
    } else if (e.key.toLowerCase() === 'p'){
      prevBtn.click();
    } else if (e.key.toLowerCase() === 'm'){
      muteBtn.click();
    } else if (e.key.toLowerCase() === 'q'){
      openQueue();
    } else if (e.key.toLowerCase() === 's'){
      setShuffle(!shuffleEnabled);
    } else if (e.key.toLowerCase() === 'r'){
      setRepeat(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off');
    } else if (e.key.toLowerCase() === 'e'){
      openEq();
    } else if (e.key.toLowerCase() === 'f' && currentIndex !== -1){
      openStats();
    }
  });

  // ---------- Restore saved library on load ----------
  (async function init(){
    const saveNote = document.getElementById('saveNote');
    const stored = await dbGetAll();
    if (stored === null || stored === undefined){
      // shouldn't happen, dbGetAll resolves [] on failure
    }
    if (!window.indexedDB){
      saveNote.innerHTML = "<strong>Not saved</strong> — your browser doesn't support local storage, so your shelf will reset next time.";
    } else if (stored.length === 0){
      // nothing stored yet, keep default note
    }
    stored
      .sort((a, b) => a.id - b.id)
      .forEach(rec => {
        const url = URL.createObjectURL(rec.file);
        const thumbUrl = rec.thumb ? URL.createObjectURL(rec.thumb) : null;
        const thumbKind = rec.thumbKind || (rec.thumb && rec.thumb.type && rec.thumb.type.startsWith('video/') ? 'video' : (rec.thumb ? 'image' : null));
        const track = { id: rec.id, file: rec.file, url, title: rec.title, kind: rec.kind, error: false, loading: false, wasmBuffer: null, thumb: rec.thumb || null, thumbUrl, thumbKind, lyrics: rec.lyrics || null, artist: rec.artist || null, album: rec.album || null, year: rec.year || null, genre: rec.genre || null, trackNum: rec.trackNum || null, duration: rec.duration || null, manualMetadata: rec.manualMetadata || {}, playCount: rec.playCount || 0, lastPlayedAt: rec.lastPlayedAt || null, addedAt: rec.addedAt || Date.now(), sourcePath: rec.sourcePath || rec.file?.webkitRelativePath || rec.file?.path || rec.file?.name || '', stems: rec.stems || null,
musicBrainzReleaseId: rec.musicBrainzReleaseId || null };
        playlist.push(track);
        nextId = Math.max(nextId, rec.id + 1);
        // Backfill file tags without replacing any manual Sleeve overrides.
        if ((!track.artist && !track.album) || (!track.year && !track.genre) || Object.keys(track.manualMetadata).length === 0) readTags(track);
      });

    const storedPlaylists = await dbGetAllPlaylists();
    storedPlaylists
      .sort((a, b) => a.id - b.id)
      .forEach(pl => {
        const trackIds = pl.trackIds || [];
        const firstTrack = playlist.find(track => track.id === trackIds[0]);
        playlists.push({ id: pl.id, name: pl.name, type: pl.type || (firstTrack && firstTrack.kind === 'video' ? 'video' : 'music'), trackIds, thumb: pl.thumb || null });
        nextPlaylistId = Math.max(nextPlaylistId, pl.id + 1);
      });

    const storedAlbumThumbs = await dbGetAllAlbumThumbs();
    storedAlbumThumbs.forEach(rec => {
      if (!rec || !rec.thumb) return;
      albumThumbs.set(rec.key, { blob: rec.thumb, url: URL.createObjectURL(rec.thumb) });
    });

    const storedArtistThumbs = await dbGetAllArtistThumbs();
    storedArtistThumbs.forEach(rec => {
      if (!rec || !rec.thumb) return;
      artistThumbs.set(rec.key, { blob: rec.thumb, url: URL.createObjectURL(rec.thumb) });
    });

    scheduleRender();
    if (playlist.length > 0) loadTrack(0, false);
    scheduleDupeCheck();
  })();
;
console.log("SLEEVE RENDERER LOADED");