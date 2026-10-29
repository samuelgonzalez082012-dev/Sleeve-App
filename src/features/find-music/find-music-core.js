'use strict';

/**
 * FIND MUSIC: CORE UTILITIES
 * Shared logic for link parsing, ISRC validation, and recording similarity.
 */

function parseReferenceLink(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Invalid reference link.');
  const url = raw.trim();

  // Handle Spotify URI: spotify:track:ID or spotify:album:ID
  if (url.startsWith('spotify:')) {
    const parts = url.split(':');
    if (parts.length < 3) throw new Error('Invalid Spotify URI.');
    const type = parts[1];
    const id = parts[2];
    if (!/^[A-Za-z0-9]{10,64}$/.test(id)) throw new Error('Invalid Spotify ID.');
    return { service: 'Spotify', type, id, url, metadataLookup: 'manual-reference' };
  }

  // Handle Spotify HTTPS URL
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS links are supported.');
    if (parsed.hostname !== 'open.spotify.com' && parsed.hostname !== 'spotify.com' && parsed.hostname !== 'www.spotify.com') {
      throw new Error('Only Spotify links are supported.');
    }
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) throw new Error('Invalid Spotify URL path.');
    const type = pathParts[0];
    const id = pathParts[1];
    if (!/^[A-Za-z0-9]{10,64}$/.test(id)) throw new Error('Invalid Spotify ID.');
    return { service: 'Spotify', type, id, url, metadataLookup: 'manual-reference' };
  } catch (e) {
    throw e;
  }
}

function cleanIsrc(isrc) {
  if (typeof isrc !== 'string') throw new Error('ISRC must be a string.');
  const cleaned = isrc.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{2}[A-Z0-9]{3}[0-9]{2}[A-Z0-9]{10}$/.test(cleaned)) {
    throw new Error('Invalid ISRC format.');
  }
  return cleaned;
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase()
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseTitle(title) {
  if (typeof title !== 'string') return '';
  // Remove (Remastered), (Live), [Official], etc.
  return title.toLowerCase()
    .replace(/\s*[\(\[].*?[\)\]]/g, '')
    .replace(/\s*-\s*.*$/g, '')
    .trim();
}

function similarity(s1, s2) {
  const n1 = normalizeText(s1);
  const n2 = normalizeText(s2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1;

  const longer = n1.length > n2.length ? n1 : n2;
  const shorter = n1.length > n2.length ? n2 : n1;

  if (shorter.length === 0) return 0;

  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }

  return matches / longer.length;
}

function scoreRecording(requested, found) {
  const reqIsrc = requested.isrc ? cleanIsrc(requested.isrc) : null;
  const foundIsrcs = Array.isArray(found.isrcs) ? found.isrcs.map(i => {
    try { return cleanIsrc(i); } catch { return null; }
  }).filter(Boolean) : [];

  const exactIsrc = reqIsrc && foundIsrcs.includes(reqIsrc);

  const titleSim = similarity(requested.title, found.title);
  const artistSim = similarity(requested.artist, found.artist);
  const albumSim = requested.album && found.album ? similarity(requested.album, found.album) : 0.5;

  const score = 0.7 * titleSim + 0.2 * artistSim + 0.1 * albumSim;

  return {
    exactIsrc,
    score: Math.max(0, Math.min(1, score)),
    titleSim,
    artistSim
  };
}

function makeProviderLinks(recording, preference = 'all') {
  const { title, artist } = recording;
  const query = encodeURIComponent(`${artist} ${title}`);

  const providers = [
    { id: 'fma', name: 'Free Music Archive', searchUrl: `https://freemusicarchive.org/search?advsearch=1&search=${query}` },
    { id: 'qobuz', name: 'Qobuz', searchUrl: `https://www.qobuz.com/search/${query}` },
    { id: 'tidal', name: 'Tidal', searchUrl: `https://tidal.com/search?q=${query}` },
    { id: 'deezer', name: 'Deezer', searchUrl: `https://www.deezer.com/search/artist/${query}` },
    { id: 'soundcloud', name: 'SoundCloud', searchUrl: `https://soundcloud.com/search?q=${query}` },
  ];

  if (preference === 'free') return providers.filter(p => p.id === 'fma');
  if (preference === 'lossless') return providers.filter(p => p.id === 'qobuz');

  return providers;
}

module.exports = {
  parseReferenceLink,
  cleanIsrc,
  normalizeText,
  baseTitle,
  similarity,
  scoreRecording,
  makeProviderLinks
};
