'use strict';
const assert = require('node:assert/strict');
const spotify = require('./find-music-spotify-main');

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => headers[String(key).toLowerCase()] || null },
    json: async () => payload
  };
}

async function main() {
  assert.throws(() => spotify.safeId('abc', 'playlist ID'), /Invalid playlist ID/);
  assert.equal(spotify.safeId('1234567890123456789012'), '1234567890123456789012');
  const mapped = spotify.mapSpotifyItem({ item: {
    id: 'abc123abc123abc123abc1', type: 'track', name: 'Test Song', duration_ms: 187000,
    track_number: 3, artists: [{ name: 'Example Artist' }],
    album: { id: 'album123456789012345678', name: 'Example Album' },
    external_ids: { isrc: 'USABC2300001' },
    external_urls: { spotify: 'https://open.spotify.com/track/abc123abc123abc123abc1' }
  }});
  assert.equal(mapped.name, 'Test Song');
  assert.equal(mapped.artistText, 'Example Artist');
  assert.equal(mapped.albumId, 'album123456789012345678');
  assert.equal(mapped.spotifyUrl, 'https://open.spotify.com/track/abc123abc123abc123abc1');
  assert.equal(mapped.isrc, 'USABC2300001');
  assert.equal(spotify.mapSpotifyItem(null).unavailable, true);

  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/playlists/1234567890123456789012') {
      return response(200, { id: '1234567890123456789012', name: 'Fixture Playlist', owner: { display_name: 'Fixture Owner' }, external_urls: { spotify: 'https://open.spotify.com/playlist/1234567890123456789012' } });
    }
    if (parsed.pathname.endsWith('/items') && parsed.searchParams.get('offset') === '0') {
      return response(200, { limit: 100, offset: 0, total: 2, next: 'https://api.spotify.com/v1/should-not-be-followed', items: [
        { item: { id: 'track0000000000000000001', type: 'track', name: 'One', artists: [{name:'A'}], duration_ms: 100000, album: {id:'album00000000000000001', name:'Album'}, external_urls: {spotify:'https://open.spotify.com/track/track0000000000000000001'} } },
        { item: { id: 'track0000000000000000002', type: 'track', name: 'Two', artists: [{name:'B'}], duration_ms: 120000, album: {id:'album00000000000000001', name:'Album'}, external_urls: {spotify:'https://open.spotify.com/track/track0000000000000000002'} } }
      ]});
    }
    if (parsed.pathname.endsWith('/items') && parsed.searchParams.get('offset') === '2') {
      return response(200, { limit: 100, offset: 2, total: 2, next: null, items: [] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await spotify.fetchSpotifyPlaylist({
    id: '1234567890123456789012', accessToken: 'token_without_spaces_123', requestId: 'spotify_test_request_01'
  }, { fetchImpl: fakeFetch, event: { sender: { isDestroyed: () => false, send: () => {} } } });
  assert.equal(result.name, 'Fixture Playlist');
  assert.equal(result.tracks.length, 2);
  assert.deepEqual(result.tracks.map((track) => track.name), ['One', 'Two']);
  assert.equal(urls.some((url) => url.includes('/should-not-be-followed')), false);

  const restrictedPlaylistFetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/playlists/1234567890123456789012') {
      return response(200, { id: '1234567890123456789012', name: 'Public Fixture' });
    }
    if (parsed.pathname.endsWith('/items')) return response(403, { error: { status: 403, message: 'Forbidden' } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await assert.rejects(
    spotify.fetchSpotifyPlaylist({
      id: '1234567890123456789012', accessToken: 'token_without_spaces_123', requestId: 'spotify_test_restrict_01'
    }, { fetchImpl: restrictedPlaylistFetch, event: { sender: { isDestroyed: () => false, send: () => {} } } }),
    /HTTP 403 Forbidden.*app owner has an active Premium plan/i
  );

  const noPlaylistItemsFetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/playlists/1234567890123456789012') {
      return response(200, { id: '1234567890123456789012', name: 'Public Fixture' });
    }
    if (parsed.pathname.endsWith('/items')) return response(200, { total: 3, limit: 100, offset: 0, next: null });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await assert.rejects(
    spotify.fetchSpotifyPlaylist({
      id: '1234567890123456789012', accessToken: 'token_without_spaces_123', requestId: 'spotify_test_missing_items_01'
    }, { fetchImpl: noPlaylistItemsFetch, event: { sender: { isDestroyed: () => false, send: () => {} } } }),
    /playlist tracks may only be exposed for playlists you own or collaborate on/i
  );

  const albumMetadataBlockedFetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/albums/album12345678901234567890') {
      return response(403, { error: { status: 403, message: 'Forbidden' } });
    }
    if (parsed.pathname === '/v1/albums/album12345678901234567890/tracks') {
      return response(200, { total: 1, limit: 50, offset: 0, next: null, items: [{
        id: 'track12345678901234567890', type: 'track', name: 'Fallback Album Track', duration_ms: 123000,
        track_number: 1, artists: [{ name: 'Fixture Artist' }], external_urls: { spotify: 'https://open.spotify.com/track/track12345678901234567890' }
      }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const albumFallback = await spotify.fetchSpotifyAlbum({
    id: 'album12345678901234567890', accessToken: 'token_without_spaces_123', requestId: 'spotify_test_album_fallback_01'
  }, { fetchImpl: albumMetadataBlockedFetch, event: { sender: { isDestroyed: () => false, send: () => {} } } });
  assert.equal(albumFallback.metadataUnavailable, true);
  assert.equal(albumFallback.tracks.length, 1);
  assert.match(albumFallback.name, /Spotify album/);

  const trackFetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/tracks/track12345678901234567890') {
      return response(200, {
        id: 'track12345678901234567890', type: 'track', name: 'Single Track', duration_ms: 191000,
        track_number: 4, artists: [{ name: 'Track Artist' }], external_ids: { isrc: 'USABC2300001' },
        external_urls: { spotify: 'https://open.spotify.com/track/track12345678901234567890' },
        album: { id: 'album12345678901234567890', name: 'Single Album', artists: [{ name: 'Track Artist' }], images: [{ url: 'https://i.scdn.co/image/fixture' }] }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const single = await spotify.fetchSpotifyTrack({
    id: 'track12345678901234567890', accessToken: 'token_without_spaces_123', requestId: 'spotify_test_track_01'
  }, { fetchImpl: trackFetch });
  assert.equal(single.kind, 'track');
  assert.equal(single.tracks.length, 1);
  assert.equal(single.tracks[0].isrc, 'USABC2300001');
  assert.equal(single.tracks[0].albumId, 'album12345678901234567890');
  assert.equal(single.coverUrl, 'https://i.scdn.co/image/fixture');

  const deniedError = await spotify.spotifyJson('https://api.spotify.com/v1/albums/album12345678901234567890', 'token', new AbortController().signal, {
    fetchImpl: async () => response(403, { error: { status: 403, message: 'App access blocked' } })
  }).catch((error) => error);
  assert.equal(deniedError.status, 403);
  assert.match(deniedError.message, /App access blocked/);
  assert.match(deniedError.message, /playlist-permission problem/);

  await assert.rejects(
    spotify.spotifyJson('https://example.com/v1/playlists/1234567890123456789012', 'token', new AbortController().signal, { fetchImpl: fakeFetch }),
    /blocked an unexpected Spotify API URL/
  );
  const throttled = await spotify.spotifyJson('https://api.spotify.com/v1/playlists/1234567890123456789012', 'token', new AbortController().signal, {
    fetchImpl: async () => response(429, {}, { 'retry-after': '7' })
  }).catch((error) => error);
  assert.match(throttled.message, /about 7 seconds/);

  const handlers = new Map();
  spotify.registerFindMusicSpotifyHandlers({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) } });
  assert.ok(handlers.has('find-music:spotify-get-playlist'));
  assert.ok(handlers.has('find-music:spotify-get-album'));
  assert.ok(handlers.has('find-music:spotify-get-track'));
  assert.ok(handlers.has('find-music:spotify-cancel'));
  assert.ok(handlers.has('find-music:spotify-exchange-code'));

  console.log('Spotify catalog tests passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
