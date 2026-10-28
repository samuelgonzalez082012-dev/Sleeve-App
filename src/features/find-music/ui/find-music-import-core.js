(function (root) {
  'use strict';

  const MAX_CSV_BYTES = 10 * 1024 * 1024;
  const MAX_TRACKS = 200;

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .toLowerCase()
      .replace(/\b(featuring|feat\.?|ft\.?)\b/g, ' feat ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[^a-z0-9]/g, '');
  }

  function parseCsvRows(text) {
    const input = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"' && input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"' && cell.length === 0) {
        quoted = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && input[i + 1] === '\n') i += 1;
        row.push(cell);
        if (row.some((value) => String(value).trim() !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    if (quoted) throw new Error('The CSV has an unclosed quoted field. Re-export it as UTF-8 CSV and try again.');
    row.push(cell);
    if (row.some((value) => String(value).trim() !== '')) rows.push(row);
    return rows;
  }

  const ALIASES = {
    title: ['trackname', 'title', 'tracktitle', 'song', 'track', 'songtitle', 'name'],
    artist: ['artistnames', 'artistname', 'artists', 'artist', 'trackartist', 'performer', 'performers'],
    album: ['albumname', 'album', 'albumtitle', 'collectionname', 'release'],
    isrc: ['isrc', 'trackisrc', 'internationalstandardrecordingcode'],
    duration: ['trackdurationms', 'durationms', 'trackduration', 'duration', 'length', 'durationseconds'],
    trackUri: ['trackuri', 'spotifytrackuri'],
    albumUri: ['albumuri', 'spotifyalbumuri'],
    popularity: ['popularity', 'trackpopularity'],
    trackNumber: ['tracknumber', 'trackno', 'tracknum'],
    coverUrl: ['albumimageurl', 'albumartworkurl', 'artworkurl', 'imageurl']
  };

  function findColumn(headers, key) {
    const aliases = ALIASES[key] || [];
    return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
  }

  function parseDuration(value, header = '') {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?\s*:\s*\d{1,2}(?::\d{1,2})?$/.test(raw)) {
      const parts = raw.split(':').map(Number);
      return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const number = Number(raw.replace(/\s*(ms|milliseconds|seconds|secs|s)\s*$/i, ''));
    if (!Number.isFinite(number) || number <= 0) return null;
    if (/ms|millisecond/i.test(header) || number > 1000) return number / 1000;
    if (/second|secs|\(s\)|durationseconds/i.test(header)) return number;
    return number;
  }

  function parseExportifyCsv(text, options = {}) {
    if (typeof text !== 'string') throw new TypeError('Please select a CSV playlist export.');
    if (BufferLikeByteLength(text) > MAX_CSV_BYTES) throw new Error('This CSV is larger than 10 MB. Export a smaller playlist and try again.');
    const rows = parseCsvRows(text);
    if (rows.length < 2) throw new Error('The CSV contains a header but no track rows.');
    const headers = rows[0].map((header) => String(header || '').trim());
    const columns = Object.fromEntries(Object.keys(ALIASES).map((key) => [key, findColumn(headers, key)]));
    if (columns.title < 0 || columns.artist < 0) {
      throw new Error('Sleeve could not identify the track-title and artist columns. Use an Exportify track CSV or a CSV with Title and Artist columns.');
    }

    const tracks = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const value = (column) => column >= 0 ? String(row[column] == null ? '' : row[column]).trim() : '';
      const title = value(columns.title);
      const artist = value(columns.artist);
      if (!title || !artist) continue;
      tracks.push({
        sourceIndex: tracks.length,
        title: title.slice(0, 240),
        artist: artist.slice(0, 240),
        album: value(columns.album).slice(0, 240),
        isrc: value(columns.isrc).replace(/[\s-]/g, '').toUpperCase(),
        durationSec: parseDuration(value(columns.duration), columns.duration >= 0 ? headers[columns.duration] : ''),
        trackUri: value(columns.trackUri),
        albumUri: value(columns.albumUri),
        popularity: Number(value(columns.popularity)) || null,
        trackNumber: Number(value(columns.trackNumber)) || null,
        coverUrl: value(columns.coverUrl),
        status: 'pending',
        message: ''
      });
      if (tracks.length > MAX_TRACKS) throw new Error(`This CSV contains more than ${MAX_TRACKS} tracks. Split the playlist into smaller exports.`);
    }
    if (!tracks.length) throw new Error('No rows contained both a track title and artist. Check the selected CSV.');
    const collectionName = String(options.fileName || 'Imported Playlist').replace(/\.[^.]+$/, '').replace(/[\r\n]/g, ' ').trim().slice(0, 120) || 'Imported Playlist';
    return { collectionName, total: tracks.length, tracks };
  }

  function BufferLikeByteLength(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    return unescape(encodeURIComponent(value)).length;
  }

  function normalizeISRC(value) {
    return String(value || '').replace(/[\s-]/g, '').toUpperCase();
  }

  function trackAlreadyInLibrary(source, libraryTrack) {
    const titleA = normalizeText(source && source.title);
    const titleB = normalizeText(libraryTrack && (libraryTrack.title || libraryTrack.name));
    const artistA = normalizeText(source && source.artist);
    const artistB = normalizeText(libraryTrack && (libraryTrack.artist || libraryTrack.artistText));
    if (!titleA || !titleB || !artistA || !artistB || titleA !== titleB || artistA !== artistB) return false;

    const sourceISRC = normalizeISRC(source && source.isrc);
    const libraryISRC = normalizeISRC(libraryTrack && (libraryTrack.isrc || (libraryTrack.manualMetadata && libraryTrack.manualMetadata.isrc)));
    if (sourceISRC && libraryISRC) return sourceISRC === libraryISRC;

    const sourceDuration = Number(source && source.durationSec) || null;
    const libraryDuration = Number(libraryTrack && libraryTrack.duration) || Number(libraryTrack && libraryTrack.durationSec) || null;
    if (sourceDuration && libraryDuration && Math.abs(sourceDuration - libraryDuration) > 8) return false;
    return true;
  }

  function markAlreadyOwned(tracks, libraryTracks) {
    const library = Array.isArray(libraryTracks) ? libraryTracks : [];
    const seenInImport = [];
    return (Array.isArray(tracks) ? tracks : []).map((track, index) => {
      const copy = { ...track, sourceIndex: Number.isInteger(track.sourceIndex) ? track.sourceIndex : index };
      const existing = library.find((entry) => trackAlreadyInLibrary(copy, entry));
      if (existing) {
        copy.status = 'already-have';
        copy.message = 'Already in your Sleeve library';
        copy.libraryMatchTitle = String(existing.title || existing.name || copy.title);
        return copy;
      }
      if (seenInImport.some((prior) => trackAlreadyInLibrary(copy, prior))) {
        copy.status = 'duplicate-in-playlist';
        copy.message = 'Duplicate of another entry in this import; only one download is needed';
        return copy;
      }
      seenInImport.push(copy);
      copy.status = 'missing';
      copy.message = 'Not found in your Sleeve library';
      return copy;
    });
  }

  const api = { MAX_CSV_BYTES, MAX_TRACKS, parseCsvRows, parseExportifyCsv, normalizeText, normalizeISRC, trackAlreadyInLibrary, markAlreadyOwned, parseDuration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SleeveFindMusicImportCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
