'use strict';

// Spotify catalog metadata only. This module intentionally does not download
// Spotify audio, search for substitute copies, or assemble playlist ZIPs.
const SPOTIFY_API = 'https://api.spotify.com/v1';
const MAX_COLLECTION_TRACKS = 5000;
const activeRequests = new Map();

function safeId(value, label = 'Spotify ID') {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9]{10,64}$/.test(id)) throw new Error(`Invalid ${label}. Paste a valid Spotify URL and try again.`);
  return id;
}

function safeRequestId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id)) throw new Error('Invalid Spotify request identifier. Close Find Music and try again.');
  return id;
}

function safeAccessToken(value) {
  const token = String(value || '').trim();
  if (!token || token.length > 8192 || /\s/.test(token)) throw new Error('Connect to Spotify again; the access token is missing or invalid.');
  return token;
}

function text(value, max = 300) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function spotifyHttpError(status, message, apiMessage = '') {
  const error = new Error(message);
  error.status = Number(status) || 0;
  error.apiMessage = text(apiMessage, 240);
  return error;
}

function spotifyForbiddenMessage(apiMessage = '') {
  const detail = text(apiMessage, 240);
  const detailPart = detail && !/^forbidden$/i.test(detail) ? ` Spotify's response: ${detail}.` : '';
  return `Spotify returned HTTP 403 Forbidden.${detailPart} For an album metadata request, this is not normally a playlist-permission problem. Check that the app owner has an active Premium plan, the Spotify account you connected is in the app's User Management allowlist, and the app is enabled in the Developer Dashboard. Then disconnect and connect Spotify again. If every catalog request gets 403, Spotify may be blocking the app at the account/app level; code changes cannot override that restriction.`;
}

function safeSpotifyImage(images) {
  if (!Array.isArray(images)) return '';
  for (const item of images) {
    const raw = text(item && item.url, 1000);
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:' && (parsed.hostname === 'i.scdn.co' || parsed.hostname.endsWith('.scdn.co'))) return parsed.href;
    } catch (_) {}
  }
  return '';
}

function mapSpotifyItem(raw, fallbackAlbum = null) {
  const wrapper = raw && typeof raw === 'object' ? raw : null;
  const track = wrapper && (wrapper.item || wrapper.track || wrapper);
  if (!track || typeof track !== 'object' || track.type === 'episode' || !text(track.name, 300)) {
    return {
      id: null,
      name: track && track.type === 'episode' ? 'Podcast episode (not a music track)' : 'Unavailable track',
      artistText: '', artists: [], albumId: fallbackAlbum && fallbackAlbum.id ? text(fallbackAlbum.id, 64) : null,
      albumName: fallbackAlbum && fallbackAlbum.name ? text(fallbackAlbum.name, 300) : '',
      durationMs: null, trackNumber: null, spotifyUrl: '', unavailable: true
    };
  }
  const album = track.album || fallbackAlbum || {};
  const artists = Array.isArray(track.artists) ? track.artists.map((artist) => text(artist && artist.name, 200)).filter(Boolean) : [];
  const spotifyUrl = text(track.external_urls && track.external_urls.spotify, 600);
  return {
    id: text(track.id, 64) || null,
    name: text(track.name, 300),
    artistText: artists.join(', '),
    artists,
    albumId: text(album.id, 64) || null,
    albumName: text(album.name, 300),
    durationMs: Number.isFinite(Number(track.duration_ms)) ? Number(track.duration_ms) : null,
    isrc: text(track.external_ids && track.external_ids.isrc, 16),
    trackNumber: Number.isFinite(Number(track.track_number)) ? Number(track.track_number) : null,
    discNumber: Number.isFinite(Number(track.disc_number)) ? Number(track.disc_number) : null,
    spotifyUrl: /^https:\/\/open\.spotify\.com\//i.test(spotifyUrl) ? spotifyUrl : '',
    unavailable: false
  };
}

function sendProgress(event, requestId, payload) {
  try {
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send('find-music:spotify-progress', { requestId, ...payload });
    }
  } catch (_) { /* renderer closed; the request may be in teardown */ }
}

async function spotifyJson(url, token, signal, options = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.spotify.com' || !parsed.pathname.startsWith('/v1/')) {
    throw new Error('Sleeve blocked an unexpected Spotify API URL.');
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('This Electron version does not provide fetch. Update Electron to use Spotify catalog integration.');

  let response;
  try {
    response = await fetchImpl(parsed.href, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new Error('Could not reach Spotify. Check your connection and try again.');
  }

  if (!response.ok) {
    // Read Spotify's response body before producing a UI-safe error. The API
    // sometimes returns useful detail, but may return only {message:'Forbidden'}.
    let errorPayload = null;
    try { errorPayload = await response.json(); } catch (_) { /* non-JSON proxy response */ }
    const apiMessage = text(
      errorPayload && errorPayload.error && (errorPayload.error.message || errorPayload.error.reason) ||
      errorPayload && (errorPayload.message || errorPayload.error_description) || '',
      240
    );

    if (response.status === 401) {
      throw spotifyHttpError(401, 'Spotify login expired. Disconnect Spotify, connect again, and retry.', apiMessage);
    }
    if (response.status === 403) {
      throw spotifyHttpError(403, spotifyForbiddenMessage(apiMessage), apiMessage);
    }
    if (response.status === 404) {
      throw spotifyHttpError(404, 'Spotify could not find this playlist or album, or it is not available to this account. Check that the pasted link is correct.', apiMessage);
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(120, Math.ceil(retryAfter)) : 30;
      throw spotifyHttpError(429, `Spotify is rate-limiting requests. Wait about ${seconds} seconds and try again.`, apiMessage);
    }
    throw spotifyHttpError(response.status, `Spotify catalog request failed (HTTP ${response.status || 'unknown'}). ${apiMessage ? `Spotify's response: ${apiMessage}. ` : ''}Try again shortly.`, apiMessage);
  }
  try { return await response.json(); }
  catch (_) { throw new Error('Spotify returned an unreadable response. Try again.'); }
}

function createRequest(payload) {
  const requestId = safeRequestId(payload && payload.requestId);
  const token = safeAccessToken(payload && payload.accessToken);
  const existing = activeRequests.get(requestId);
  if (existing) existing.abort();
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  return { requestId, token, controller };
}

async function getPagedItems({ firstUrl, pageUrl, token, controller, requestId, event, collectionName, albumFallback = null, itemLimit, fetchImpl = globalThis.fetch, playlistAccessHint = false }) {
  const output = [];
  let offset = 0;
  let reportedTotal = null;
  let nextUrl = firstUrl;

  while (nextUrl) {
    if (controller.signal.aborted) throw Object.assign(new Error('Fetch cancelled because Find Music was closed or reset.'), { name: 'AbortError' });
    const page = await spotifyJson(nextUrl, token, controller.signal, { fetchImpl });
    if (!Array.isArray(page.items)) {
      if (playlistAccessHint) {
        throw new Error('Spotify returned playlist metadata but did not include its items. Under Spotify’s current Web API rules, playlist tracks may only be exposed for playlists you own or collaborate on. Try a playlist you own or one where you are a collaborator.');
      }
      throw new Error('Spotify returned no track list for this album. Check the album URL and try again.');
    }
    const pageItems = page.items;
    if (reportedTotal == null && Number.isFinite(Number(page.total))) reportedTotal = Number(page.total);
    if (reportedTotal != null && reportedTotal > MAX_COLLECTION_TRACKS) {
      throw new Error(`This collection contains ${reportedTotal.toLocaleString()} items, exceeding Sleeve’s safe limit of ${MAX_COLLECTION_TRACKS.toLocaleString()} per view.`);
    }

    for (const raw of pageItems) {
      output.push(mapSpotifyItem(raw, albumFallback));
      sendProgress(event, requestId, {
        phase: 'loading', collectionName,
        processed: output.length,
        total: reportedTotal || output.length,
        message: `Loading ${collectionName.toLowerCase()} metadata: ${output.length}${reportedTotal ? ` of ${reportedTotal}` : ''}…`
      });
      if (output.length >= MAX_COLLECTION_TRACKS) break;
    }

    if (output.length >= MAX_COLLECTION_TRACKS) break;
    const pageLimit = Number(page.limit) || itemLimit;
    offset += pageItems.length || pageLimit;
    if (typeof page.next === 'string' && page.next) {
      // Never follow an arbitrary API-provided URL. Build the next page ourselves.
      nextUrl = pageUrl(offset);
    } else {
      nextUrl = null;
    }
    if (pageItems.length === 0) nextUrl = null;
  }

  return { tracks: output, total: reportedTotal == null ? output.length : reportedTotal };
}

async function fetchSpotifyPlaylist(payload, dependencies = {}) {
  const { requestId, token, controller } = createRequest(payload);
  const event = dependencies.event;
  try {
    const id = safeId(payload.id, 'playlist ID');
    const metadata = await spotifyJson(`${SPOTIFY_API}/playlists/${encodeURIComponent(id)}?fields=id,name,external_urls,owner(display_name),images(url)`, token, controller.signal, dependencies);
    const playlistName = text(metadata.name, 300) || 'Spotify playlist';
    const firstUrl = `${SPOTIFY_API}/playlists/${encodeURIComponent(id)}/items?limit=100&offset=0&additional_types=track`;
    let result;
    try {
      result = await getPagedItems({
        firstUrl,
        pageUrl: (offset) => `${SPOTIFY_API}/playlists/${encodeURIComponent(id)}/items?limit=100&offset=${offset}&additional_types=track`,
        token, controller, requestId, event, collectionName: playlistName, itemLimit: 100, fetchImpl: dependencies.fetchImpl, playlistAccessHint: true
      });
    } catch (error) {
      // Preserve Spotify's actual HTTP/API diagnostics. A generic 403 can be
      // an app/account gate, not necessarily the playlist ownership restriction.
      throw error;
    }
    if (controller.signal.aborted) throw Object.assign(new Error('Fetch cancelled.'), { name: 'AbortError' });
    return {
      kind: 'playlist', id,
      name: playlistName,
      spotifyUrl: `https://open.spotify.com/playlist/${id}`,
      owner: text(metadata.owner && metadata.owner.display_name, 200),
      coverUrl: safeSpotifyImage(metadata.images),
      tracks: result.tracks,
      total: result.total
    };
  } finally {
    if (activeRequests.get(requestId) === controller) activeRequests.delete(requestId);
  }
}

async function fetchSpotifyAlbum(payload, dependencies = {}) {
  const { requestId, token, controller } = createRequest(payload);
  const event = dependencies.event;
  try {
    const id = safeId(payload.id, 'album ID');
    let metadata = null;
    let metadata403 = null;
    try {
      metadata = await spotifyJson(`${SPOTIFY_API}/albums/${encodeURIComponent(id)}?market=US`, token, controller.signal, dependencies);
    } catch (error) {
      // The album-track endpoint is the essential data for this view. Try it
      // if the metadata endpoint is blocked, rather than failing before it is
      // attempted; some Spotify access failures are endpoint-specific.
      if (error && error.status === 403) metadata403 = error;
      else throw error;
    }
    const albumName = text(metadata && metadata.name, 300) || text(payload.albumName, 300) || `Spotify album (${id.slice(0, 6)}…)`;
    const albumArtists = Array.isArray(metadata && metadata.artists) ? metadata.artists.map((artist) => text(artist && artist.name, 200)).filter(Boolean) : [];
    const albumFallback = { id, name: albumName };
    const firstUrl = `${SPOTIFY_API}/albums/${encodeURIComponent(id)}/tracks?limit=50&offset=0&market=US`;
    let result;
    try {
      result = await getPagedItems({
        firstUrl,
        pageUrl: (offset) => `${SPOTIFY_API}/albums/${encodeURIComponent(id)}/tracks?limit=50&offset=${offset}&market=US`,
        token, controller, requestId, event, collectionName: albumName, albumFallback, itemLimit: 50, fetchImpl: dependencies.fetchImpl
      });
    } catch (error) {
      if (metadata403 && error && error.status === 403) {
        throw new Error(`Spotify denied both album metadata and album tracks. ${metadata403.message}`);
      }
      throw error;
    }
    if (controller.signal.aborted) throw Object.assign(new Error('Fetch cancelled.'), { name: 'AbortError' });
    const tracks = result.tracks.map((track) => ({ ...track, albumId: id, albumName }));
    return {
      kind: 'album', id,
      name: albumName,
      artistText: albumArtists.join(', '),
      coverUrl: safeSpotifyImage(metadata && metadata.images),
      spotifyUrl: `https://open.spotify.com/album/${id}`,
      tracks,
      total: result.total,
      metadataUnavailable: !metadata
    };
  } finally {
    if (activeRequests.get(requestId) === controller) activeRequests.delete(requestId);
  }
}

async function fetchSpotifyTrack(payload, dependencies = {}) {
  const { requestId, token, controller } = createRequest(payload);
  try {
    const id = safeId(payload.id, 'track ID');
    const trackData = await spotifyJson(`${SPOTIFY_API}/tracks/${encodeURIComponent(id)}?market=US`, token, controller.signal, dependencies);
    if (controller.signal.aborted) throw Object.assign(new Error('Fetch cancelled.'), { name: 'AbortError' });
    const track = mapSpotifyItem(trackData);
    if (track.unavailable) throw new Error('Spotify returned no usable metadata for this track.');
    const album = trackData.album || {};
    return {
      kind: 'track', id,
      name: track.name,
      artistText: track.artistText,
      coverUrl: safeSpotifyImage(album.images),
      spotifyUrl: `https://open.spotify.com/track/${id}`,
      tracks: [{ ...track, albumId: text(album.id, 64) || null, albumName: text(album.name, 300) }],
      total: 1
    };
  } finally {
    if (activeRequests.get(requestId) === controller) activeRequests.delete(requestId);
  }
}

function registerFindMusicSpotifyHandlers({ ipcMain }) {
  if (!ipcMain) throw new TypeError('ipcMain is required');

  ipcMain.handle('find-music:spotify-exchange-code', async (_event, payload) => {
    const clientId = text(payload && payload.clientId, 160);
    const code = text(payload && payload.code, 4096);
    const codeVerifier = text(payload && payload.codeVerifier, 160);
    const redirectUri = text(payload && payload.redirectUri, 300);
    if (!/^[A-Za-z0-9]{20,64}$/.test(clientId)) throw new Error('Enter a valid Spotify Client ID.');
    if (!code || !codeVerifier) throw new Error('Spotify returned no authorization code. Connect again.');
    if (redirectUri !== 'http://127.0.0.1:43897/callback') throw new Error('Unexpected Spotify redirect URI.');
    let response;
    try {
      if (typeof globalThis.fetch !== 'function') throw new Error('fetch is unavailable');
      response = await globalThis.fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier
        })
      });
    } catch (_) {
      throw new Error('Could not reach Spotify’s token service. Check your connection and try again.');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      const description = text(body.error_description || body.error, 240);
      throw new Error(`Spotify token exchange failed (HTTP ${response.status || 'unknown'}). ${description || 'Check the Client ID and the registered redirect URI.'}`);
    }
    return { accessToken: text(body.access_token, 8192), expiresIn: Number(body.expires_in) || 3600, tokenType: text(body.token_type, 40) || 'Bearer' };
  });

  ipcMain.handle('find-music:spotify-get-playlist', async (event, payload) => fetchSpotifyPlaylist(payload, { event }));
  ipcMain.handle('find-music:spotify-get-album', async (event, payload) => fetchSpotifyAlbum(payload, { event }));
  ipcMain.handle('find-music:spotify-get-track', async (event, payload) => fetchSpotifyTrack(payload, { event }));
  ipcMain.handle('find-music:spotify-cancel', async (_event, requestId) => {
    let id;
    try { id = safeRequestId(requestId); } catch (_) { return { cancelled: false }; }
    const controller = activeRequests.get(id);
    if (controller) {
      controller.abort();
      activeRequests.delete(id);
      return { cancelled: true };
    }
    return { cancelled: false };
  });
}

module.exports = {
  registerFindMusicSpotifyHandlers,
  safeId,
  safeRequestId,
  mapSpotifyItem,
  spotifyJson,
  spotifyForbiddenMessage,
  fetchSpotifyPlaylist,
  fetchSpotifyAlbum,
  fetchSpotifyTrack,
  safeSpotifyImage,
  MAX_COLLECTION_TRACKS
};
