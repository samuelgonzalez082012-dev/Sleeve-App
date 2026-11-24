'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../find-music-spotify-links');
const core = require('../find-music-core');

test('builds Spotify artist and music search links without requiring Spotify API access', () => {
  const result = links.buildArtistLinks('Björk & The Sugarcubes');
  assert.equal(result.artistUrl, 'https://open.spotify.com/search/Bj%C3%B6rk%20%26%20The%20Sugarcubes');
  assert.equal(result.musicUrl, 'https://open.spotify.com/search/Bj%C3%B6rk%20%26%20The%20Sugarcubes%20songs');
  assert.equal(core.isAllowedHost(new URL(result.artistUrl).hostname), true);
  assert.equal(core.isAllowedHost(new URL(result.musicUrl).hostname), true);
});

test('rejects empty artist names and safely encodes search text', () => {
  assert.equal(links.buildArtistLinks('  '), null);
  assert.equal(links.buildSpotifySearchUrl('  '), '');
  const url = new URL(links.buildSpotifySearchUrl('Artist / with ? symbols'));
  assert.equal(url.origin, 'https://open.spotify.com');
  assert.equal(url.pathname, '/search/Artist%20%2F%20with%20%3F%20symbols');
});

test('bounds search input length', () => {
  const url = links.buildSpotifySearchUrl('x'.repeat(500));
  assert.equal(decodeURIComponent(url.split('/search/')[1]).length, 240);
});
