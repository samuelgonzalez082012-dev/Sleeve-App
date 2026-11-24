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

  function isSpotifyContentUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      const host = url.hostname.toLowerCase();
      const hosts = ['open.spotify.com', 'spotify.com', 'www.spotify.com', 'spotify.link'];
      if (url.protocol !== 'https:' || !hosts.includes(host)) return false;
      if (host === 'spotify.link') return url.pathname.length > 1;
      const parts = url.pathname.split('/').filter(Boolean);
      const typeIndex = parts.findIndex((part) => ['track', 'album', 'playlist', 'artist'].includes(part));
      return typeIndex >= 0 && Boolean(parts[typeIndex + 1]) && parts.length === typeIndex + 2;
    } catch (_) {
      return false;
    }
  }

  function isSpotifySearchUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' &&
        url.hostname.toLowerCase() === 'open.spotify.com' &&
        url.pathname.startsWith('/search/') &&
        url.pathname.length > '/search/'.length;
    } catch (_) {
      return false;
    }
  }

  function buildSpotdlDiscoveryContext(artistName) {
    const name = String(artistName == null ? '' : artistName).trim().slice(0, 200);
    if (!name) return null;
    return { artistName: name, artistSearchUrl: buildSpotifySearchUrl(name) };
  }

  return { buildSpotifySearchUrl, buildArtistLinks, buildSpotdlDiscoveryContext, isSpotifyContentUrl, isSpotifySearchUrl };
});
