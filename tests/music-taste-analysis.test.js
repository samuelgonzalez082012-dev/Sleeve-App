'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../music-taste-analysis');
test('uses play counts to rank genres and artists when history exists', () => {
  const profile = analyze([
    { kind: 'audio', artist: 'Artist One', genre: 'Rock', playCount: 8 },
    { kind: 'audio', artist: 'Artist One', genre: 'Rock', playCount: 2 },
    { kind: 'audio', artist: 'Artist Two', genre: 'Jazz', playCount: 4 },
    { kind: 'video', artist: 'Video Artist', genre: 'Pop', playCount: 100 }
  ], { now: 1000 });
  assert.equal(profile.trackCount, 3);
  assert.equal(profile.totalPlays, 14);
  assert.equal(profile.rankingBasis, 'plays');
  assert.equal(profile.genres[0].name, 'Rock');
  assert.equal(profile.genres[0].sharePercent, 71);
  assert.equal(profile.artists[0].name, 'Artist One');
  assert.equal(profile.artists[0].sharePercent, 71);
});
test('falls back to library composition when no play history exists', () => {
  const profile = analyze([{ artist: 'A', genre: 'Rock' }, { artist: 'B', genre: 'Rock' }, { artist: 'C', genre: 'Jazz' }], { now: 1000 });
  assert.equal(profile.rankingBasis, 'track-count');
  assert.equal(profile.genres[0].name, 'Rock');
  assert.equal(profile.genres[0].sharePercent, 67);
});
test('reports metadata coverage and recent tracks without inventing tags', () => {
  const profile = analyze([{ artist: 'Artist', genre: 'Unknown Genre', lastPlayedAt: 950 }, { artist: '', genre: 'Metal', lastPlayedAt: 500 }], { now: 1000, recentWindowMs: 100 });
  assert.equal(profile.metadataCoverage.genreTaggedTrackCount, 1);
  assert.equal(profile.metadataCoverage.artistTaggedTrackCount, 1);
  assert.equal(profile.recentlyPlayedTrackCount, 1);
  assert.deepEqual(profile.genres.map((item) => item.name), ['Metal']);
});
test('handles empty and malformed input safely', () => {
  const profile = analyze(null, { now: 1000 });
  assert.equal(profile.trackCount, 0);
  assert.equal(profile.totalPlays, 0);
  assert.deepEqual(profile.genres, []);
  assert.deepEqual(profile.artists, []);
  assert.equal(profile.metadataCoverage.genrePercent, 0);
});
test('builds a taste mix from the top genres using only local audio tracks', () => {
  const tracks = [
    { id: 1, title: 'Rock One', genre: 'Rock', playCount: 10 },
    { id: 2, title: 'Rock Two', genre: 'Rock', playCount: 8 },
    { id: 3, title: 'Jazz One', genre: 'Jazz', playCount: 5 },
    { id: 4, title: 'Pop One', genre: 'Pop', playCount: 2 },
    { id: 5, title: 'Video', genre: 'Rock', kind: 'video', playCount: 100 },
    { title: 'No ID', genre: 'Rock', playCount: 50 }
  ];
  const profile = analyze(tracks, { now: 1000 });
  const mix = require('../music-taste-analysis').buildTasteMixTracks(tracks, profile, 4);
  assert.equal(mix.length, 4);
  assert.deepEqual(mix.map((track) => track.id).sort(), [1, 2, 3, 4]);
});

test('returns no taste mix when there is no genre metadata and respects limits', () => {
  const api = require('../music-taste-analysis');
  const tracks = [{ id: 1, genre: 'Rock' }, { id: 2, genre: 'Rock' }, { id: 3, genre: 'Jazz' }];
  assert.deepEqual(api.buildTasteMixTracks(tracks, { genres: [] }, 25), []);
  const profile = api.analyze(tracks, { now: 1000 });
  assert.equal(api.buildTasteMixTracks(tracks, profile, 1).length, 1);
});
test('recent listening gives newly explored genres a place in the Taste Mix', () => {
  const api = require('../music-taste-analysis');
  const now = 1000000000;
  const tracks = [
    { id: 1, title: 'Old Rock', artist: 'Rock Artist', genre: 'Rock', playCount: 20, lastPlayedAt: now - 60 * 86400000 },
    { id: 2, title: 'Old Jazz', artist: 'Jazz Artist', genre: 'Jazz', playCount: 2, lastPlayedAt: now - 60 * 86400000 },
    { id: 3, title: 'New Electronic', artist: 'Electronic Artist', genre: 'Electronic', playCount: 1, lastPlayedAt: now - 86400000 }
  ];
  const profile = api.analyze(tracks, { now });
  assert.equal(profile.genres[0].name, 'Rock');
  assert.equal(profile.genres[1].name, 'Electronic');
  const mix = api.buildTasteMixTracks(tracks, profile, 3);
  assert.equal(mix.length, 3);
  assert.deepEqual(mix.map((track) => track.id).sort(), [1, 2, 3]);
});

test('Taste Mix uses fresh weighted picks and reduces repeats from earlier mixes', () => {
  const api = require('../music-taste-analysis');
  const tracks = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1, title: 'Track ' + (index + 1), artist: 'Artist ' + (index + 1),
    genre: 'Electronic', playCount: 1
  }));
  const profile = { genres: [{ name: 'Electronic', sharePercent: 100 }] };
  const first = api.buildTasteMixTracks(tracks, profile, 4, { random: () => 0.25 });
  const second = api.buildTasteMixTracks(tracks, profile, 4, { random: () => 0.75 });
  assert.equal(new Set(first.map((track) => track.id)).size, 4);
  assert.equal(new Set(second.map((track) => track.id)).size, 4);
  assert.notDeepEqual(first.map((track) => track.id), second.map((track) => track.id));
  const refreshed = api.buildTasteMixTracks(tracks, profile, 4, {
    random: () => 0.5,
    previousTrackIds: first.map((track) => track.id)
  });
  assert.equal(new Set(refreshed.map((track) => track.id)).size, 4);
  assert.ok(refreshed.some((track) => !first.some((oldTrack) => oldTrack.id === track.id)));
});
