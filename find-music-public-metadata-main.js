'use strict';

const core = require('./find-music-core');

const SPOTIFY_OEMBED = 'https://open.spotify.com/oembed';
const YOUTUBE_OEMBED = 'https://www.youtube.com/oembed';
const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const REQUEST_TIMEOUT_MS = 12000;
const MAX_ALBUM_CANDIDATES = 8;
const MAX_TRACK_CANDIDATES = 8;

function safeText(value, max = 240) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function youtubeReference(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '').trim()); }
  catch (_) { throw new Error('Paste a valid YouTube video or playlist URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Use a safe HTTPS YouTube link without embedded credentials.');
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
    throw new Error('Paste a YouTube or YouTube Music link.');
  }
  let videoId = parsed.searchParams.get('v') || '';
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  if (!videoId && host === 'youtu.be') videoId = pathParts[0] || '';
  if (!videoId && ['shorts', 'embed', 'live'].includes((pathParts[0] || '').toLowerCase())) videoId = pathParts[1] || '';
  if (videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('That YouTube link does not contain a valid video ID.');
    return { service: 'YouTube', type: 'video', id: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, playlistId: safeText(parsed.searchParams.get('list') || '', 120) };
  }
  const listId = safeText(parsed.searchParams.get('list') || '', 120);
  if (listId && /^[A-Za-z0-9_-]{8,120}$/.test(listId)) {
    return { service: 'YouTube', type: 'playlist', id: listId, url: `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}` };
  }
  throw new Error('Paste a YouTube video URL. YouTube playlist URLs need a track-list export; this workflow does not download audio from YouTube.');
}

function spotifyReference(rawUrl) {
  const reference = core.parseReferenceLink(rawUrl);
  if (reference.service !== 'Spotify' || !['track', 'album', 'playlist'].includes(reference.type)) {
    throw new Error('Paste a Spotify track, album, or playlist link.');
  }
  if (!/^[A-Za-z0-9]{10,64}$/.test(reference.id || '')) throw new Error('That Spotify link does not contain a valid item ID.');
  return { ...reference, url: `https://open.spotify.com/${reference.type}/${reference.id}` };
}

async function fetchJson(url, serviceName, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('This version of Electron does not provide fetch. Update Electron to use public metadata lookup.');
  let response;
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(options.timeoutMs || REQUEST_TIMEOUT_MS)
      : undefined;
    response = await fetchImpl(url, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw new Error(`${serviceName} took too long to respond. Check your connection and try again.`);
    throw new Error(`Could not reach ${serviceName}. Check your internet connection and try again.`);
  }
  if (!response || !response.ok) {
    const status = response && Number(response.status) || 0;
    if (status === 429 || status >= 500) throw new Error(`${serviceName} is temporarily busy (HTTP ${status}). Wait a moment and retry.`);
    if (status === 404) throw new Error(`${serviceName} could not find metadata for this link.`);
    throw new Error(`${serviceName} request failed (HTTP ${status || 'unknown'}).`);
  }
  try { return await response.json(); }
  catch (_) { throw new Error(`${serviceName} returned an unreadable response. Try again.`); }
}

async function fetchYouTubeOEmbed(reference, options = {}) {
  const url = `${YOUTUBE_OEMBED}?url=${encodeURIComponent(reference.url)}&format=json`;
  const data = await fetchJson(url, 'YouTube public video metadata', options);
  const title = safeText(data.title, 240);
  if (!title) throw new Error('YouTube returned no public title for this video.');
  const thumbnailUrl = typeof data.thumbnail_url === 'string' && /^https:\/\/i.ytimg.com\//i.test(data.thumbnail_url)
    ? data.thumbnail_url : '';
  return {
    title,
    authorName: safeText(data.author_name || '', 240),
    authorUrl: typeof data.author_url === 'string' && /^https:\/\/(?:www\.)?youtube\.com\//i.test(data.author_url) ? data.author_url : '',
    thumbnailUrl,
    providerName: 'YouTube'
  };
}

function parseYouTubeTrackTitle(rawTitle, authorName = '') {
  let title = safeText(rawTitle, 240)
    .replace(/\s*[([]\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visuali[sz]er|lyric video|hd|4k|mv|performance|remaster(?:ed)?)[^\])]*[)\]]/ig, ' ')
    .replace(/\s*[-|–—]?\s*(?:official music video|official audio|lyrics video|lyric video|visuali[sz]er|official video|official lyrics|full song|hd audio|4k video)\s*$/ig, ' ')
    .replace(/\s+/g, ' ').trim();
  const author = safeText(authorName, 240).replace(/\s*-\s*Topic$/i, '').trim();
  let artist = '';
  const parts = title.split(/\s+(?:-|–|—)\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const left = parts[0];
    const right = parts.slice(1).join(' - ');
    const authorLeft = author ? core.similarity(author, left) : 0;
    const authorRight = author ? core.similarity(author, right) : 0;
    if (authorLeft >= 0.55 || (!author && parts.length === 2)) { artist = left; title = right; }
    else if (authorRight >= 0.55) { artist = right; title = left; }
    else { artist = left; title = right; }
  }
  if (!artist && author && core.similarity(author, title) < 0.75) artist = author;
  return { title: safeText(title, 240), artist: safeText(artist || author, 240), originalTitle: safeText(rawTitle, 240) };
}

async function fetchOEmbed(reference, options = {}) {
  const url = `${SPOTIFY_OEMBED}?url=${encodeURIComponent(reference.url)}`;
  const data = await fetchJson(url, 'Spotify public link metadata', options);
  const title = safeText(data.title, 240);
  if (!title) throw new Error('Spotify returned no public title for this link.');
  const thumbnailUrl = typeof data.thumbnail_url === 'string' && /^https:\/\/i\.scdn\.co\//i.test(data.thumbnail_url)
    ? data.thumbnail_url : '';
  return { title, thumbnailUrl, providerName: safeText(data.provider_name || 'Spotify', 40) };
}

function buildItunesSearchUrl(term, entity, limit = 25) {
  const params = new URLSearchParams({ term: safeText(term, 240), entity, limit: String(limit), country: 'us' });
  return `${ITUNES_SEARCH}?${params.toString()}`;
}

function resultArtist(result) {
  return safeText(result.artistName || result.collectionArtistName || '', 240);
}

function itunesTrackCandidate(result, spotifyTitle) {
  const title = safeText(result.trackName || '', 240);
  const artist = resultArtist(result);
  const album = safeText(result.collectionName || '', 240);
  const score = core.similarity(spotifyTitle, title);
  return {
    source: 'Apple public catalog',
    trackId: Number(result.trackId) || null,
    collectionId: Number(result.collectionId) || null,
    title,
    artist,
    album,
    durationSec: Number(result.trackTimeMillis) > 0 ? Number(result.trackTimeMillis) / 1000 : null,
    trackNumber: Number(result.trackNumber) || null,
    trackCount: Number(result.trackCount) || null,
    artworkUrl: safeText(result.artworkUrl100 || result.artworkUrl60 || '', 500),
    isrc: safeText(result.isrc || '', 20).toUpperCase(),
    titleScore: score,
    matchScore: Math.round(score * 100),
    storeUrl: safeText(result.trackViewUrl || '', 1000)
  };
}

function albumCandidate(result, spotifyTitle) {
  const title = safeText(result.collectionName || result.trackName || '', 240);
  const artist = resultArtist(result);
  return {
    collectionId: Number(result.collectionId) || null,
    title,
    artist,
    trackCount: Number(result.trackCount) || null,
    releaseDate: safeText(result.releaseDate || '', 40).slice(0, 10),
    artworkUrl: safeText(result.artworkUrl100 || result.artworkUrl60 || '', 500),
    storeUrl: safeText(result.collectionViewUrl || '', 1000),
    titleScore: core.similarity(spotifyTitle, title)
  };
}

function selectClearTop(items, scoreKey = 'titleScore') {
  if (!items.length) return { selected: null, ambiguous: false };
  const sorted = [...items].sort((a, b) => Number(b[scoreKey] || 0) - Number(a[scoreKey] || 0));
  const first = sorted[0];
  if (Number(first[scoreKey] || 0) < 0.90) return { selected: null, ambiguous: true, candidates: sorted };
  const close = sorted.filter((item) => Number(first[scoreKey] || 0) - Number(item[scoreKey] || 0) <= 0.04);
  const distinctArtists = new Set(close.map((item) => core.normalizeText(item.artist)).filter(Boolean));
  if (distinctArtists.size > 1) return { selected: null, ambiguous: true, candidates: sorted };
  return { selected: first, ambiguous: false, candidates: sorted };
}

async function searchItunesTracks(title, options = {}, searchTerm = title, expectedArtist = '') {
  const json = await fetchJson(buildItunesSearchUrl(searchTerm, 'song', 30), 'Public music metadata', options);
  const expected = safeText(expectedArtist, 240);
  const results = (Array.isArray(json.results) ? json.results : [])
    .filter((row) => row && row.wrapperType === 'track' && row.kind === 'song')
    .map((row) => {
      const candidate = itunesTrackCandidate(row, title);
      const artistScore = expected ? core.similarity(expected, candidate.artist) : 1;
      candidate.artistScore = artistScore;
      candidate.combinedScore = expected ? (candidate.titleScore * 0.80 + artistScore * 0.20) : candidate.titleScore;
      candidate.matchScore = Math.round(candidate.combinedScore * 100);
      return candidate;
    })
    .filter((row) => row.title && row.artist && row.titleScore >= 0.60)
    .sort((a, b) => b.combinedScore - a.combinedScore);
  const trimmed = results.slice(0, MAX_TRACK_CANDIDATES);
  const selection = selectClearTop(trimmed, 'combinedScore');
  return { candidates: trimmed, ...selection };
}

async function searchItunesAlbums(title, options = {}) {
  const json = await fetchJson(buildItunesSearchUrl(title, 'album', 30), 'Public album metadata', options);
  const results = (Array.isArray(json.results) ? json.results : [])
    .filter((row) => row && row.wrapperType === 'collection' && row.collectionId)
    .map((row) => albumCandidate(row, title))
    .filter((row) => row.title && row.artist && row.titleScore >= 0.65)
    .sort((a, b) => b.titleScore - a.titleScore);
  const trimmed = results.slice(0, MAX_ALBUM_CANDIDATES);
  const selection = selectClearTop(trimmed);
  return { candidates: trimmed, ...selection };
}

async function getItunesAlbumTracks(collectionId, options = {}) {
  const id = String(collectionId || '');
  if (!/^\d{1,16}$/.test(id)) throw new Error('The selected album has an invalid public catalog ID.');
  const url = `${ITUNES_LOOKUP}?id=${encodeURIComponent(id)}&entity=song&country=us`;
  const data = await fetchJson(url, 'Public album track list', options);
  const all = Array.isArray(data.results) ? data.results : [];
  const album = all.find((row) => row && row.wrapperType === 'collection');
  const trackRows = all.filter((row) => row && row.wrapperType === 'track' && row.kind === 'song' && row.trackId);
  if (!trackRows.length) throw new Error('The public catalog did not return any playable album tracks for this release.');
  if (trackRows.length > 500) throw new Error('This album has an unusually large track list and cannot be imported safely.');
  const baseAlbum = album ? safeText(album.collectionName, 240) : '';
  return {
    collectionName: baseAlbum || safeText(trackRows[0].collectionName, 240) || 'Album',
    artist: album ? resultArtist(album) : resultArtist(trackRows[0]),
    artworkUrl: album ? safeText(album.artworkUrl100 || album.artworkUrl60 || '', 500) : safeText(trackRows[0].artworkUrl100 || '', 500),
    storeUrl: album ? safeText(album.collectionViewUrl || '', 1000) : '',
    total: trackRows.length,
    tracks: trackRows.map((row, index) => itunesTrackCandidate(row, row.trackName)).map((track, index) => ({
      sourceIndex: index,
      title: track.title,
      artist: track.artist,
      album: track.album || baseAlbum,
      isrc: track.isrc,
      durationSec: track.durationSec,
      trackNumber: track.trackNumber || index + 1,
      trackUri: '',
      status: 'pending',
      message: ''
    }))
  };
}

async function resolvePublicSpotifyLink(payload, options = {}) {
  const reference = spotifyReference(payload && payload.url);
  if (reference.type === 'playlist') {
    return {
      requiresCsv: true,
      kind: 'playlist',
      referenceUrl: reference.url,
      title: 'Spotify playlist',
      message: 'To avoid Spotify Web API login and Premium-dependent access, import this playlist’s Exportify CSV. Paste the playlist link only as an optional reference.'
    };
  }

  const oembed = await fetchOEmbed(reference, options);
  if (reference.type === 'track') {
    const selection = await searchItunesTracks(oembed.title, options);
    if (!selection.candidates.length) {
      throw new Error(`Spotify identifies this track as “${oembed.title}”, but the public music catalog could not find a matching track. You can import a playlist CSV or use manual search.`);
    }
    const track = selection.selected;
    return {
      kind: 'track',
      referenceUrl: reference.url,
      spotifyTitle: oembed.title,
      thumbnailUrl: oembed.thumbnailUrl,
      ambiguous: !track,
      candidates: track ? [] : selection.candidates,
      track: track ? {
        sourceIndex: 0,
        title: track.title,
        artist: track.artist,
        album: track.album,
        isrc: track.isrc,
        durationSec: track.durationSec,
        trackNumber: track.trackNumber || 1,
        trackUri: '',
        collectionId: track.collectionId,
        artworkUrl: track.artworkUrl || oembed.thumbnailUrl,
        status: 'pending',
        message: ''
      } : null,
      message: track ? 'Resolved public track metadata. Sleeve will look for a permitted audio download.' : 'This title has multiple plausible public-catalog matches. Choose the right artist to avoid downloading the wrong recording.'
    };
  }

  const selection = await searchItunesAlbums(oembed.title, options);
  if (!selection.candidates.length) {
    throw new Error(`Spotify identifies this album as “${oembed.title}”, but no sufficiently close public catalog album was found.`);
  }
  const chosen = selection.selected;
  const album = chosen ? await getItunesAlbumTracks(chosen.collectionId, options) : null;
  return {
    kind: 'album',
    referenceUrl: reference.url,
    spotifyTitle: oembed.title,
    thumbnailUrl: oembed.thumbnailUrl,
    ambiguous: !chosen,
    candidates: chosen ? [] : selection.candidates,
    collection: album ? {
      ...album,
      artworkUrl: album.artworkUrl || chosen.artworkUrl || oembed.thumbnailUrl,
      tracks: album.tracks
    } : null,
    message: album ? `Loaded ${album.total} tracks from the closest public catalog album match.` : 'Several albums have similar titles. Choose the matching artist/release to continue.'
  };
}

async function resolvePublicYouTubeLink(payload, options = {}) {
  const reference = youtubeReference(payload && payload.url);
  if (reference.type === 'playlist') {
    return {
      requiresCsv: true,
      kind: 'playlist',
      referenceUrl: reference.url,
      title: 'YouTube playlist',
      message: 'YouTube playlist link recognized. This version can read individual public video metadata, but it does not enumerate/download playlist audio from YouTube. Import a CSV track list to resolve the songs through supported download sources.'
    };
  }
  const oembed = await fetchYouTubeOEmbed(reference, options);
  const parsed = parseYouTubeTrackTitle(oembed.title, oembed.authorName);
  const searchTerm = [parsed.artist, parsed.title, oembed.authorName].filter(Boolean).join(' ');
  const selection = await searchItunesTracks(parsed.title || oembed.title, options, searchTerm, parsed.artist);
  if (!selection.candidates.length) {
    throw new Error(`YouTube identifies this video as “${oembed.title}”, but the public music catalog could not find a plausible recording. Try a cleaner official-audio/video URL or manual search.`);
  }
  const track = selection.selected;
  return {
    kind: 'track',
    referenceUrl: reference.url,
    sourceService: 'YouTube',
    youtubeTitle: oembed.title,
    thumbnailUrl: oembed.thumbnailUrl,
    ambiguous: !track,
    candidates: track ? [] : selection.candidates,
    track: track ? {
      sourceIndex: 0,
      title: track.title,
      artist: track.artist,
      album: track.album,
      isrc: track.isrc,
      durationSec: track.durationSec,
      trackNumber: track.trackNumber || 1,
      trackUri: '',
      collectionId: track.collectionId,
      artworkUrl: track.artworkUrl || oembed.thumbnailUrl,
      status: 'pending',
      message: ''
    } : null,
    message: track
      ? 'Matched YouTube video metadata to a public music-catalog recording. Download Audio will only use a separately supported source with eligible download rights; it will not download or extract YouTube audio.'
      : 'Several public-catalog recordings may match this video. Choose the correct artist before resolving an eligible audio source.'
  };
}

async function resolvePublicLink(payload, options = {}) {
  const raw = String(payload && payload.url || '').trim();
  if (/^(?:https:\/\/)?(?:(?:www\.|m\.|music\.)?youtube\.com|youtu\.be)\//i.test(raw)) {
    return resolvePublicYouTubeLink(payload, options);
  }
  return resolvePublicSpotifyLink(payload, options);
}

function registerFindMusicPublicMetadataHandlers({ ipcMain }) {
  if (!ipcMain) throw new TypeError('ipcMain is required');
  ipcMain.handle('find-music:resolve-public-link', async (_event, payload) => resolvePublicLink(payload));
  ipcMain.handle('find-music:get-public-album-tracks', async (_event, collectionId) => getItunesAlbumTracks(collectionId));
}

module.exports = {
  spotifyReference,
  youtubeReference,
  fetchJson,
  fetchOEmbed,
  fetchYouTubeOEmbed,
  parseYouTubeTrackTitle,
  searchItunesTracks,
  searchItunesAlbums,
  getItunesAlbumTracks,
  resolvePublicSpotifyLink,
  resolvePublicYouTubeLink,
  resolvePublicLink,
  registerFindMusicPublicMetadataHandlers,
  selectClearTop,
  itunesTrackCandidate,
  albumCandidate,
  buildItunesSearchUrl
};
