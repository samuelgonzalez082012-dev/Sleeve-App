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

test('builds a safe SpotDL launch context for a discovered artist', () => {
  const context = links.buildSpotdlDiscoveryContext('  Björk & The Sugarcubes  ');
  assert.deepEqual(context, {
    artistName: 'Björk & The Sugarcubes',
    artistSearchUrl: 'https://open.spotify.com/search/Bj%C3%B6rk%20%26%20The%20Sugarcubes'
  });
  assert.equal(core.isAllowedHost(new URL(context.artistSearchUrl).hostname), true);
  assert.equal(links.buildSpotdlDiscoveryContext('   '), null);
  assert.equal(links.buildSpotdlDiscoveryContext('x'.repeat(250)).artistName.length, 200);
});

test('distinguishes canonical Spotify content URLs from search URLs', () => {
  assert.equal(links.isSpotifyContentUrl('https://open.spotify.com/artist/abc123'), true);
  assert.equal(links.isSpotifyContentUrl('https://open.spotify.com/intl-en/track/abc123?si=share'), true);
  assert.equal(links.isSpotifyContentUrl('https://spotify.link/shortcode'), true);
  assert.equal(links.isSpotifyContentUrl('https://open.spotify.com/search/Bj%C3%B6rk'), false);
  assert.equal(links.isSpotifyContentUrl('http://open.spotify.com/track/abc123'), false);
  assert.equal(links.isSpotifyContentUrl('https://example.com/track/abc123'), false);
  assert.equal(links.isSpotifyContentUrl('https://open.spotify.com/artist/abc123/extra'), false);
});

test('recognizes only HTTPS Spotify artist-search URLs for the discovery shortcut', () => {
  assert.equal(links.isSpotifySearchUrl('https://open.spotify.com/search/Bj%C3%B6rk'), true);
  assert.equal(links.isSpotifySearchUrl('https://open.spotify.com/search/'), false);
  assert.equal(links.isSpotifySearchUrl('http://open.spotify.com/search/Bjork'), false);
  assert.equal(links.isSpotifySearchUrl('https://example.com/search/Bjork'), false);
});
