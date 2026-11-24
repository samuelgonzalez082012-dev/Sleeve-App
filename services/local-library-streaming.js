'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.wave', '.flac', '.m4a', '.m4b', '.aac', '.ogg',
  '.oga', '.opus', '.wma', '.aiff', '.aif', '.alac', '.ape', '.wv'
]);
const MIME_TYPES = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wave': 'audio/wav',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  '.alac': 'audio/mp4', '.ape': 'audio/ape', '.wv': 'audio/wav'
};
const MAX_PAGE_SIZE = 200;
const MAX_TRACKS = 20000;

function safeText(value, max = 180) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || start >= size || end < start) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

class LocalLibraryStreaming {
  constructor(options = {}) {
    this.ffmpegPathProvider = options.ffmpegPathProvider || null;
    this.tracks = new Map();
    this.playlists = [];
    this.updatedAt = null;
  }

  setSnapshot(tracks, playlists) {
    if (!Array.isArray(tracks) || tracks.length > MAX_TRACKS) {
      throw new Error('Library snapshot must contain a valid track list.');
    }
    const nextTracks = new Map();
    for (const item of tracks) {
      if (!item || !Number.isSafeInteger(Number(item.id)) || Number(item.id) < 0) continue;
      if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) continue;
      const ext = path.extname(item.path).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext) || item.kind === 'video') continue;
      const record = {
        id: String(item.id),
        title: safeText(item.title, 200) || 'Untitled',
        artist: safeText(item.artist, 160),
        album: safeText(item.album, 160),
        year: safeText(item.year, 12),
        genre: safeText(item.genre, 100),
        duration: Number.isFinite(Number(item.duration)) && Number(item.duration) > 0 ? Number(item.duration) : null,
        trackNum: Number.isSafeInteger(Number(item.trackNum)) ? Number(item.trackNum) : null,
        path: item.path,
        extension: ext
      };
      nextTracks.set(record.id, record);
    }
    const nextPlaylists = Array.isArray(playlists) ? playlists.slice(0, 2000).map(item => ({
      id: safeText(item && item.id, 40),
      name: safeText(item && item.name, 120) || 'Untitled playlist',
      type: item && item.type === 'video' ? 'video' : 'music',
      trackIds: Array.isArray(item && item.trackIds)
        ? item.trackIds.map(id => String(id)).filter(id => nextTracks.has(id)).slice(0, MAX_TRACKS)
        : []
    })) : [];
    this.tracks = nextTracks;
    this.playlists = nextPlaylists;
    this.updatedAt = new Date().toISOString();
    return { tracks: this.tracks.size, playlists: this.playlists.length, updatedAt: this.updatedAt };
  }

  publicTrack(track) {
    const { path: privatePath, ...publicRecord } = track;
    return publicRecord;
  }

  page(items, url) {
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(url.searchParams.get('limit')) || 100));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  }

  async handleRequest(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/v1/library') {
      const tracks = [...this.tracks.values()];
      const groups = (key) => new Set(tracks.map(track => track[key]).filter(Boolean)).size;
      return this.sendJson(res, 200, {
        updatedAt: this.updatedAt,
        counts: {
          tracks: tracks.length,
          albums: new Set(tracks.map(track => track.album && track.artist + '\u0000' + track.album).filter(Boolean)).size,
          artists: groups('artist'),
          genres: groups('genre'),
          playlists: this.playlists.filter(item => item.type === 'music').length
        },
        sections: ['tracks', 'albums', 'artists', 'playlists', 'genres']
      });
    }

    if (req.method === 'GET' && url.pathname === '/v1/library/tracks') {
      const query = safeText(url.searchParams.get('q'), 100).toLowerCase();
      const items = [...this.tracks.values()]
        .filter(track => !query || [track.title, track.artist, track.album, track.genre].some(value => value.toLowerCase().includes(query)))
        .sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || a.title.localeCompare(b.title))
        .map(track => this.publicTrack(track));
      return this.sendJson(res, 200, this.page(items, url));
    }

    if (req.method === 'GET' && url.pathname === '/v1/library/albums') {
      const albums = new Map();
      for (const track of this.tracks.values()) {
        if (!track.album) continue;
        const key = track.artist + '\u0000' + track.album;
        if (!albums.has(key)) albums.set(key, {
          id: key, title: track.album, artist: track.artist, year: track.year, trackCount: 0
        });
        albums.get(key).trackCount += 1;
      }
      return this.sendJson(res, 200, this.page([...albums.values()].sort((a, b) =>
        a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)), url));
    }

    if (req.method === 'GET' && url.pathname === '/v1/library/artists') {
      const artists = new Map();
      for (const track of this.tracks.values()) {
        if (!track.artist) continue;
        if (!artists.has(track.artist)) artists.set(track.artist, { name: track.artist, trackCount: 0, albums: new Set() });
        const artist = artists.get(track.artist);
        artist.trackCount += 1;
        if (track.album) artist.albums.add(track.album);
      }
      const items = [...artists.values()].map(item => ({
        name: item.name, trackCount: item.trackCount, albumCount: item.albums.size
      })).sort((a, b) => a.name.localeCompare(b.name));
      return this.sendJson(res, 200, this.page(items, url));
    }

    if (req.method === 'GET' && url.pathname === '/v1/library/genres') {
      const items = [...new Set([...this.tracks.values()].map(track => track.genre).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      return this.sendJson(res, 200, { items });
    }

    if (req.method === 'GET' && url.pathname === '/v1/library/playlists') {
      return this.sendJson(res, 200, this.page(this.playlists.filter(item => item.type === 'music').map(item => ({
        id: item.id, name: item.name, trackCount: item.trackIds.length
      })), url));
    }

    const playlistMatch = /^\/v1\/library\/playlists\/([^/]+)\/tracks$/.exec(url.pathname);
    if (req.method === 'GET' && playlistMatch) {
      const playlist = this.playlists.find(item => item.id === decodeURIComponent(playlistMatch[1]) && item.type === 'music');
      if (!playlist) return this.sendJson(res, 404, { error: 'Playlist not found.' });
      const items = playlist.trackIds.map(id => this.tracks.get(id)).filter(Boolean).map(track => this.publicTrack(track));
      return this.sendJson(res, 200, this.page(items, url));
    }

    const streamMatch = /^\/v1\/tracks\/(\d+)\/stream$/.exec(url.pathname);
    if (req.method === 'GET' && streamMatch) {
      const track = this.tracks.get(streamMatch[1]);
      if (!track) return this.sendJson(res, 404, { error: 'Track not found in the shared library.' });
      return this.streamTrack(req, res, url, track);
    }
    return false;
  }

  async streamTrack(req, res, url, track) {
    let stat;
    try {
      const linkStat = fs.lstatSync(track.path);
      if (!linkStat.isFile() || linkStat.isSymbolicLink()) throw new Error('Not a regular file');
      stat = fs.statSync(track.path);
    } catch (_) {
      return this.sendJson(res, 404, { error: 'The source file is no longer available on the host.' });
    }
    const quality = url.searchParams.get('quality') || 'original';
    if (quality !== 'original' && quality !== 'compact') {
      return this.sendJson(res, 400, { error: 'Quality must be original or compact.' });
    }
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-disposition', 'inline');
    if (quality === 'compact') return this.streamCompact(req, res, url, track);
    const range = parseRange(req.headers.range, stat.size);
    if (range && range.invalid) {
      res.writeHead(416, { 'content-range': 'bytes */' + stat.size, 'accept-ranges': 'bytes' });
      return res.end();
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;
    res.writeHead(range ? 206 : 200, {
      'content-type': MIME_TYPES[track.extension] || 'application/octet-stream',
      'content-length': end - start + 1,
      'accept-ranges': 'bytes',
      ...(range ? { 'content-range': 'bytes ' + start + '-' + end + '/' + stat.size } : {})
    });
    const stream = fs.createReadStream(track.path, { start, end });
    stream.on('error', () => { if (!res.headersSent) this.sendJson(res, 500, { error: 'Could not read the source file.' }); else res.destroy(); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  async streamCompact(req, res, url, track) {
    if (typeof this.ffmpegPathProvider !== 'function') {
      return this.sendJson(res, 503, { error: 'Compact quality requires FFmpeg on the host.' });
    }
    let ffmpegPath = '';
    try { ffmpegPath = await this.ffmpegPathProvider(); } catch (_) {}
    if (!ffmpegPath) return this.sendJson(res, 503, { error: 'Compact quality requires FFmpeg on the host.' });
    const startSeconds = Math.max(0, Math.min(24 * 60 * 60, Number(url.searchParams.get('start')) || 0));
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      ...(startSeconds > 0 ? ['-ss', String(startSeconds)] : []),
      '-i', track.path, '-map', '0:a:0', '-vn',
      '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1'
    ];
    res.writeHead(200, {
      'content-type': 'audio/mpeg',
      'cache-control': 'no-store',
      'accept-ranges': 'none',
      'transfer-encoding': 'chunked'
    });
    let child;
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
      return res.destroy();
    }
    child.stdout.pipe(res);
    child.once('error', () => res.destroy());
    child.once('close', code => { if (code !== 0 && !res.writableEnded) res.destroy(); });
    const stop = () => { try { child.kill(); } catch (_) {} };
    res.once('close', stop);
  }

  sendJson(res, status, value) {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
}

module.exports = { LocalLibraryStreaming, parseRange, AUDIO_EXTENSIONS };
