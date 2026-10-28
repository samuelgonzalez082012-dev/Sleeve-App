'use strict';
const assert = require('node:assert/strict');
const pub = require('./find-music-public-metadata-main');

const ok = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

(async () => {
  const valid = pub.spotifyReference('https://open.spotify.com/track/1234567890123456789012?si=example');
  assert.equal(valid.type, 'track');
  assert.equal(valid.url, 'https://open.spotify.com/track/1234567890123456789012');
  assert.throws(() => pub.spotifyReference('https://evil.example/track/1234567890123456789012'), /domain|supported music-link/i);

  const playlist = await pub.resolvePublicSpotifyLink({ url: 'https://open.spotify.com/playlist/1234567890123456789012' }, { fetchImpl: async () => { throw new Error('playlist lookup must not call Spotify API'); } });
  assert.equal(playlist.requiresCsv, true);
  assert.match(playlist.message, /Exportify CSV/i);

  const trackResponses = [
    { title: 'Paper Planes', thumbnail_url: 'https://i.scdn.co/image/example', provider_name: 'Spotify' },
    { resultCount: 2, results: [
      { wrapperType: 'track', kind: 'song', trackId: 1, collectionId: 101, trackName: 'Paper Planes', artistName: 'M.I.A.', collectionName: 'Kala', trackTimeMillis: 205000, trackNumber: 5, artworkUrl100: 'https://is.example/cover.jpg' },
      { wrapperType: 'track', kind: 'song', trackId: 2, collectionId: 202, trackName: 'Paper Planes', artistName: 'Another Artist', collectionName: 'Other Album', trackTimeMillis: 205000 }
    ] }
  ];
  const track = await pub.resolvePublicSpotifyLink({ url: 'https://open.spotify.com/track/1234567890123456789012' }, { fetchImpl: async (url) => ok(trackResponses.shift()) });
  assert.equal(track.kind, 'track');
  assert.equal(track.ambiguous, true);
  assert.equal(track.candidates.length, 2);
  assert.equal(track.track, null);

  const albumResponses = [
    { title: 'Kind of Blue', thumbnail_url: 'https://i.scdn.co/image/example' },
    { resultCount: 1, results: [{ wrapperType: 'collection', collectionId: 12345, collectionName: 'Kind of Blue', artistName: 'Miles Davis', trackCount: 2, releaseDate: '1959-08-17', artworkUrl100: 'https://is.example/cover.jpg' }] },
    { resultCount: 3, results: [
      { wrapperType: 'collection', collectionId: 12345, collectionName: 'Kind of Blue', artistName: 'Miles Davis', trackCount: 2, artworkUrl100: 'https://is.example/cover.jpg' },
      { wrapperType: 'track', kind: 'song', trackId: 101, collectionId: 12345, collectionName: 'Kind of Blue', artistName: 'Miles Davis', trackName: 'So What', trackNumber: 1, trackTimeMillis: 545000 },
      { wrapperType: 'track', kind: 'song', trackId: 102, collectionId: 12345, collectionName: 'Kind of Blue', artistName: 'Miles Davis', trackName: 'Freddie Freeloader', trackNumber: 2, trackTimeMillis: 589000 }
    ] }
  ];
  const album = await pub.resolvePublicSpotifyLink({ url: 'https://open.spotify.com/album/1234567890123456789012' }, { fetchImpl: async () => ok(albumResponses.shift()) });
  assert.equal(album.kind, 'album');
  assert.equal(album.ambiguous, false);
  assert.equal(album.collection.artist, 'Miles Davis');
  assert.equal(album.collection.tracks.length, 2);
  assert.equal(album.collection.tracks[0].title, 'So What');
  assert.equal(album.collection.tracks[0].durationSec, 545);

  await assert.rejects(() => pub.fetchJson('https://example.com', 'Public metadata', { fetchImpl: async () => ok({}, 403) }), /HTTP 403/);
  console.log('Premium-free public metadata tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
