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
  assert.deepEqual(mix.map((track) => track.id), [1, 2, 3, 4]);
});

test('returns no taste mix when there is no genre metadata and respects limits', () => {
  const api = require('../music-taste-analysis');
  const tracks = [{ id: 1, genre: 'Rock' }, { id: 2, genre: 'Rock' }, { id: 3, genre: 'Jazz' }];
  assert.deepEqual(api.buildTasteMixTracks(tracks, { genres: [] }, 25), []);
  const profile = api.analyze(tracks, { now: 1000 });
  assert.equal(api.buildTasteMixTracks(tracks, profile, 1).length, 1);
});