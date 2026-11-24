/* Phase 4.4: safe Spotify web-search links for discovered artists. */
(function attachSleeveSpotifyLinks(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SleeveSpotifyLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSpotifyLinks() {
  'use strict';

  const SPOTIFY_SEARCH_BASE = 'https://open.spotify.com/search/';

  function buildSpotifySearchUrl(query) {
    const value = String(query == null ? '' : query).trim().slice(0, 240);
    if (!value) return '';
    return SPOTIFY_SEARCH_BASE + encodeURIComponent(value);
  }

  function buildArtistLinks(artistName) {
    const name = String(artistName == null ? '' : artistName).trim().slice(0, 200);
    if (!name) return null;
    return {
      artistUrl: buildSpotifySearchUrl(name),
      musicUrl: buildSpotifySearchUrl(name + ' songs')
    };
  }

  function buildSpotdlDiscoveryContext(artistName) {
    const name = String(artistName == null ? '' : artistName).trim().slice(0, 200);
    if (!name) return null;
    return { artistName: name, artistSearchUrl: buildSpotifySearchUrl(name) };
  }

  return { buildSpotifySearchUrl, buildArtistLinks, buildSpotdlDiscoveryContext };
});
