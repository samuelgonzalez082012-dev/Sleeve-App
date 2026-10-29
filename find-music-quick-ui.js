/* Antra-inspired quick link workflow for Sleeve. Uses Sleeve's existing
 * Spotify metadata and explicitly licensed direct-download modules; no webview
 * or streaming-audio extraction is added. */
(() => {
  'use strict';
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('fmQuickDownloadShell')) return;

  const overlay = document.getElementById('sleeveFindMusicOverlay');
  const content = overlay && overlay.querySelector('.find-music-content');
  const spotifySection = content && content.querySelector('#fmSpotifySection');
  if (!overlay || !content || !spotifySection) return;

  const get = (id) => document.getElementById(id);
  const urlRow = spotifySection.querySelector('.fm-spotify-link-row');
  const status = get('fmSpotifyStatus');
  const authStatus = get('fmSpotifyAuthStatus');
  const connectionRow = spotifySection.querySelector('.fm-spotify-connect-row');
  const progressWrap = get('fmSpotifyProgressWrap');
  const collectionHeader = get('fmSpotifyCollectionHeader');
  const trackList = get('fmSpotifyTracks');
  const note = spotifySection.querySelector('.find-music-watch-note');
  if (!urlRow || !status || !connectionRow || !progressWrap || !collectionHeader || !trackList) return;

  const shell = document.createElement('section');
  shell.id = 'fmQuickDownloadShell';
  shell.className = 'find-music-card fm-quick-download-card';
  shell.innerHTML = `
    <div class="fm-quick-brand-row">
      <div class="fm-quick-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="fm-quick-brand-copy">
        <span class="fm-quick-eyebrow">SLEEVE · FIND MUSIC</span>
        <h3>Paste a link. Download audio.</h3>
        <p>Resolve the track list, review the best available matches, then download directly into your library.</p>
      </div>
    </div>
    <div class="fm-quick-supported-note"><span class="fm-quick-status-dot"></span><span>Spotify track, album, and playlist links · Direct downloads from supported, explicitly licensed sources</span></div>
    <div class="fm-quick-connection"></div>
    <div class="fm-quick-results-area"></div>
    <p class="fm-quick-legal-note">Sleeve does not copy audio from Spotify streams. A track is downloaded only when a supported source exposes a direct file and declares an eligible license; unmatched tracks are reported instead of guessing.</p>
  `;

  const connectionDetails = document.createElement('details');
  connectionDetails.className = 'fm-quick-connection-details';
  connectionDetails.innerHTML = '<summary>Spotify connection settings</summary><p>Spotify API access is used to read track, album, or playlist metadata. If Spotify denies access, Sleeve cannot bypass that restriction.</p>';
  const connectionBody = document.createElement('div');
  connectionBody.className = 'fm-quick-connection-body';
  connectionBody.append(connectionRow);
  if (authStatus) connectionBody.append(authStatus);
  connectionDetails.append(connectionBody);
  shell.querySelector('.fm-quick-connection').append(connectionDetails);

  // Move the existing, already-wired controls rather than duplicating them.
  // Existing event handlers keep their references and continue to work.
  const urlInput = get('fmSpotifyUrl');
  const loadButton = get('fmSpotifyLoad');
  if (urlInput) {
    const label = urlRow.querySelector('label');
    if (label) label.textContent = 'Music link';
    urlInput.placeholder = 'Paste a Spotify track, album, or playlist URL';
    urlInput.setAttribute('aria-label', 'Spotify track, album, or playlist URL');
  }
  if (loadButton) {
    loadButton.textContent = 'Resolve link';
    loadButton.classList.add('fm-quick-resolve-button');
  }
  shell.querySelector('.fm-quick-results-area').append(urlRow, status, progressWrap, collectionHeader, trackList);
  if (note) note.remove();

  // Keep the established manual search, source links, folder watcher, and import
  // controls available under a collapsed disclosure instead of deleting them.
  const advanced = document.createElement('details');
  advanced.className = 'fm-advanced-tools';
  advanced.innerHTML = '<summary>Advanced tools and manual search</summary>';
  const advancedBody = document.createElement('div');
  advancedBody.className = 'fm-advanced-tools-body';
  advanced.append(advancedBody);

  const priorChildren = Array.from(content.children).filter((child) => child !== spotifySection);
  content.insertBefore(shell, content.firstChild);
  for (const child of priorChildren) advancedBody.appendChild(child);
  if (advancedBody.childElementCount) content.appendChild(advanced);
  // Keep the empty section element as an idempotence guard for the Spotify UI.
  spotifySection.hidden = true;

  // Expand connection settings when an API response makes authentication setup relevant.
  const statusObserver = new MutationObserver(() => {
    const message = status.textContent || '';
    if (/connect to spotify|client id|authorization|login expired/i.test(message)) connectionDetails.open = true;
  });
  statusObserver.observe(status, { childList: true, subtree: true, characterData: true });

  // Match Antra's paste-and-wait flow: a recognized Spotify link starts resolving
  // after a paste. Typing can still be completed manually with Enter or Resolve link.
  let pasteTimer = null;
  if (urlInput && loadButton) {
    urlInput.addEventListener('paste', () => {
      if (pasteTimer) clearTimeout(pasteTimer);
      pasteTimer = setTimeout(() => {
        const value = urlInput.value.trim();
        if (/(?:open\.spotify\.com\/(?:track|album|playlist)\/|spotify:(?:track|album|playlist):)/i.test(value)) {
          loadButton.click();
        }
      }, 80);
    });
  }

  // Give a single track the same one-click visual emphasis as a whole collection.
  // The actual download/validation remains in the existing download module.
  document.addEventListener('sleeve:find-music-reset', () => {
    connectionDetails.open = false;
    advanced.open = false;
    if (pasteTimer) clearTimeout(pasteTimer);
    pasteTimer = null;
  });
})();
