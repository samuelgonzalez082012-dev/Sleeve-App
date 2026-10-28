'use strict';

/**
 * FIND MUSIC: DOWNLOAD MODULE
 * Combined Backend (Main Process) and Frontend (Renderer Process) logic.
 */

// =============================================================================
// BACKEND LOGIC (Main Process)
// =============================================================================
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const core = require('./find-music-core');

const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 300 * 1024 * 1024;
const MAX_ZIP_AUDIO_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_COLLECTION_TRACKS = 200;
const MAX_COLLECTION_ZIP_BYTES = 480 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.wave', '.ogg', '.oga', '.opus', '.m4a', '.m4b', '.aac',
  '.flac', '.alac', '.aiff', '.aif', '.ape', '.wv', '.dsf', '.dff', '.mpc',
  '.mid', '.midi'
]);
const LICENSE_PATH_PATTERNS = [
  /^\/licenses\/by(?:-nc-nd|-nc-sa|-nc|-nd|-sa)?\/[1-4]\.\d\/?$/i,
  /^\/publicdomain\/(?:zero|mark)\/1\.0\/?$/i
];

function isArchiveHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'archive.org' || host.endsWith('.archive.org');
}

function isSafeArchiveIdentifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(value || ''));
}

function isExplicitlyOpenLicense(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    return ['https:', 'http:'].includes(url.protocol) && url.hostname.toLowerCase() === 'creativecommons.org' &&
      LICENSE_PATH_PATTERNS.some((pattern) => pattern.test(url.pathname));
  } catch (_) {
    return false;
  }
}

function licenseLabel(rawUrl) {
  if (!isExplicitlyOpenLicense(rawUrl)) return '';
  const url = new URL(rawUrl);
  const pathLower = url.pathname.toLowerCase();
  const cc = pathLower.match(/^\/licenses\/(by(?:-nc-nd|-nc-sa|-nc|-nd|-sa)?)\/([1-4]\.\d)\/?$/);
  if (cc) return `Creative Commons ${cc[1].toUpperCase()} ${cc[2]}`;
  const pd = pathLower.match(/^\/publicdomain\/(zero|mark)\/1\.0\/?$/);
  if (pd) return pd[1] === 'zero' ? 'CC0 1.0 Public Domain Dedication' : 'Public Domain Mark 1.0';
  return 'Open license';
}

function isAudioFilename(rawName) {
  const name = String(rawName || '').replace(/\\/g, '/');
  return AUDIO_EXTENSIONS.has(path.posix.extname(name).toLowerCase());
}

function isZipFilename(rawName) {
  return path.extname(String(rawName || '')).toLowerCase() === '.zip';
}

function sanitizeFileName(rawName) {
  let name = path.basename(String(rawName || '').replace(/\\/g, '/'))
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!name || name === '.' || name === '..') name = 'download';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name.slice(0, 180) || 'download';
}

function safeText(value, limit = 240) {
  if (Array.isArray(value)) return value.map((part) => safeText(part, 100)).filter(Boolean).join(', ').slice(0, limit);
  if (value == null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function archivePhrase(value) {
  return safeText(value, 180).replace(/[\\"{}\[\]^~*?:!()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function archiveHeaders() {
  return {
    'User-Agent': 'Sleeve/1.0 (local music library; Internet Archive public metadata and downloads)',
    'Accept': 'application/json, audio/*, application/octet-stream, */*'
  };
}

async function safeArchiveFetch(rawUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('This Electron runtime does not provide fetch. Update Electron to use in-app music downloads.');
  let current;
  try { current = new URL(String(rawUrl)); } catch (_) { throw new Error('Invalid Internet Archive URL.'); }
  for (let hop = 0; hop <= 5; hop += 1) {
    if (current.protocol !== 'https:' || !isArchiveHost(current.hostname) || current.username || current.password) {
      throw new Error('Sleeve blocked a download URL outside the official Internet Archive HTTPS domain.');
    }
    let response;
    try {
      const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000;
      const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs) : undefined;
      response = await fetchImpl(current.href, {
        method: 'GET',
        headers: archiveHeaders(),
        redirect: 'manual',
        ...(signal ? { signal } : {})
      });
    } catch (error) {
      throw new Error(`Internet Archive could not be reached: ${safeText(error && error.message, 180) || 'network error'}.`);
    }
    if ([301, 302, 303, 307, 308].includes(Number(response.status))) {
      const location = response.headers && response.headers.get ? response.headers.get('location') : '';
      if (!location) return response;
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error('Internet Archive redirected too many times; Sleeve stopped the request.');
}

async function fetchArchiveJson(url, options = {}) {
  const response = await safeArchiveFetch(url, options);
  if (!response.ok) throw new Error(`Internet Archive request failed (HTTP ${response.status || 'unknown'}).`);
  try { return await response.json(); }
  catch (_) { throw new Error('Internet Archive returned data that was not valid JSON.'); }
}

function metadataLicense(metadata) {
  const value = metadata && (metadata.licenseurl || metadata.license_url);
  return typeof value === 'string' ? value.trim() : '';
}

function formatRank(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return ({ '.flac': 1, '.alac': 2, '.wav': 3, '.aiff': 4, '.aif': 4, '.ape': 5, '.wv': 5, '.mp3': 6, '.m4a': 7, '.ogg': 8, '.oga': 8, '.opus': 9, '.aac': 10, '.wma': 11 })[ext] || 20;
}

function mapAudioFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((file) => {
    if (!file || typeof file.name !== 'string') return false;
    const name = file.name;
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') return false;
    if (String(file.private || '').toLowerCase() === 'true') return false;
    if (!isAudioFilename(name)) return false;
    const size = Number(file.size);
    return !(Number.isFinite(size) && size > MAX_AUDIO_BYTES);
  }).map((file) => ({
    name: file.name,
    format: safeText(file.format, 80) || path.extname(file.name).slice(1).toUpperCase(),
    size: Number(file.size) || 0
  })).sort((a, b) => formatRank(a.name) - formatRank(b.name) || a.name.localeCompare(b.name)).slice(0, 40);
}

async function getArchiveItem(identifier, options = {}) {
  if (!isSafeArchiveIdentifier(identifier)) throw new Error('Invalid Internet Archive item identifier.');
  const json = await fetchArchiveJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, options);
  const metadata = json && json.metadata && typeof json.metadata === 'object' ? json.metadata : {};
  const licenseUrl = metadataLicense(metadata);
  return { json, metadata, licenseUrl, licenseLabel: licenseLabel(licenseUrl) };
}

async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = await mapper(items[index], index); }
      catch (_) { results[index] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

async function searchOpenLicensedAudio(payload, options = {}) {
  const title = safeText(payload && payload.title, 180);
  const artist = safeText(payload && payload.artist, 180);
  const album = safeText(payload && payload.album, 180);
  const queryParts = ['mediatype:audio'];
  if (title) queryParts.push(`title:"${archivePhrase(title)}"`);
  if (artist) queryParts.push(`creator:"${archivePhrase(artist)}"`);
  if (!title && !artist) throw new Error('Enter a title or artist above before searching downloadable music.');
  const maxCandidates = Number.isInteger(options.maxCandidates) ? Math.min(30, Math.max(1, options.maxCandidates)) : 30;
  const metadataConcurrency = Number.isInteger(options.metadataConcurrency) ? Math.min(3, Math.max(1, options.metadataConcurrency)) : 3;
  const paramsFor = (query) => {
    const params = new URLSearchParams();
    params.set('q', query);
    for (const field of ['identifier', 'title', 'creator', 'date', 'year', 'mediatype']) params.append('fl[]', field);
    params.set('rows', '30');
    params.set('page', '1');
    params.set('output', 'json');
    return params;
  };
  const queryVariants = [queryParts.join(' AND ')];
  if (title && artist) queryVariants.push(['mediatype:audio', `title:"${archivePhrase(title)}"`].join(' AND '));
  if (artist && (!title || title && artist)) queryVariants.push(['mediatype:audio', `creator:"${archivePhrase(artist)}"`].join(' AND '));
  const uniqueDocs = new Map();
  let lastQuery = queryVariants[0];
  for (const query of [...new Set(queryVariants)]) {
    lastQuery = query;
    const listing = await fetchArchiveJson(`https://archive.org/advancedsearch.php?${paramsFor(query).toString()}`, options);
    const found = listing && listing.response && Array.isArray(listing.response.docs) ? listing.response.docs : [];
    for (const doc of found) if (doc && doc.identifier && !uniqueDocs.has(String(doc.identifier))) uniqueDocs.set(String(doc.identifier), doc);
    if (uniqueDocs.size > 0) break;
  }
  const docs = Array.from(uniqueDocs.values()).slice(0, maxCandidates);
  const mapped = await mapWithLimit(docs.slice(0, maxCandidates), metadataConcurrency, async (doc) => {
    if (!doc || !isSafeArchiveIdentifier(doc.identifier)) return null;
    const item = await getArchiveItem(doc.identifier, options);
    if (String(item.metadata.mediatype || doc.mediatype || '').toLowerCase() !== 'audio') return null;
    if (!item.licenseLabel) return null;
    const files = mapAudioFiles(item.json.files);
    if (!files.length) return null;
    const metadata = item.metadata;
    return {
      identifier: doc.identifier,
      title: safeText(metadata.title || doc.title, 200) || 'Untitled audio item',
      creator: safeText(metadata.creator || doc.creator, 180) || 'Unknown creator',
      isrc: safeText(metadata.isrc || metadata.ISRC || '', 16),
      album: safeText(metadata.album || metadata.collection, 180),
      year: safeText(metadata.year || metadata.date || doc.year || doc.date, 40),
      licenseUrl: item.licenseUrl,
      licenseLabel: item.licenseLabel,
      itemUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      files
    };
  });
  const results = mapped.filter(Boolean).slice(0, 12);
  return {
    query: lastQuery,
    results,
    totalCandidates: docs.length,
    note: results.length
      ? 'Only Internet Archive items with an explicit supported Creative Commons or public-domain license and direct audio files are shown. Confirm each item’s rights before reuse.'
      : 'No items with an explicit supported Creative Commons/public-domain license and direct audio files were found for this query. Try a shorter title or artist name.'
  };
}

async function resolveOpenLicensedTrack(payload, options = {}) {
  const title = safeText(payload && (payload.title || payload.name), 180);
  const artist = safeText(payload && (payload.artist || payload.artistText), 180);
  const album = safeText(payload && (payload.album || payload.albumName), 180);
  const isrc = (() => { try { return core.cleanIsrc(payload && payload.isrc); } catch (_) { return ''; } })();
  if (!title || !artist) throw new Error('A track title and artist are required to find a reliable open-license match.');
  const search = await searchOpenLicensedAudio({ title, artist, album, isrc }, {
    ...options,
    maxCandidates: Number.isInteger(options.maxCandidates) ? options.maxCandidates : 10,
    metadataConcurrency: Number.isInteger(options.metadataConcurrency) ? options.metadataConcurrency : 2
  });
  const candidates = [];
  for (const item of search.results || []) {
    const files = Array.isArray(item.files) ? item.files : [];
    for (const file of files) {
      const score = scoreOpenLicensedTrack({ title, artist, album, isrc }, item, file);
      if (!score || !score.accepted) continue;
      candidates.push({ item, file, ...score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || (a.file.size || 0) - (b.file.size || 0));
  return candidates[0] || null;
}

async function scoreOpenLicensedTrack(track, item, file) {
  const requestedTitle = safeText(track && (track.title || track.name), 180);
  const requestedArtist = safeText(track && (track.artist || track.artistText), 180);
  const requestedAlbum = safeText(track && (track.album || track.albumName), 180);
  const requestedIsrc = (() => { try { return core.cleanIsrc(track && track.isrc); } catch (_) { return ''; } })();
  const sourceIsrc = (() => { try { return core.cleanIsrc(item && item.isrc); } catch (_) { return ''; } })();
  const exactIsrc = Boolean(requestedIsrc && sourceIsrc && requestedIsrc === sourceIsrc);
  if (!requestedTitle || !requestedArtist || !item || !file) return null;

  const fileTitle = cleanTrackFileTitle(file.name);
  let titleScore = core.similarity(core.baseTitle(requestedTitle), fileTitle);
  if (Array.isArray(item.files) && item.files.length === 1) {
    titleScore = Math.max(titleScore, core.similarity(core.baseTitle(requestedTitle), core.baseTitle(item.title)));
  }
  const artistScore = item.creator && item.creator !== 'Unknown creator'
    ? core.similarity(requestedArtist, item.creator)
    : 0;
  const albumScore = requestedAlbum && item.album ? core.similarity(requestedAlbum, item.album) : 0.5;
  const similarityScore = 0.74 * titleScore + 0.22 * artistScore + 0.04 * albumScore;
  const score = exactIsrc ? Math.max(0.99, similarityScore) : similarityScore;
  return {
    titleScore,
    artistScore,
    albumScore,
    exactIsrc,
    score: Math.max(0, Math.min(1, score)),
    accepted: exactIsrc || (titleScore >= 0.78 && artistScore >= 0.48 && similarityScore >= 0.75)
  };
}

async function downloadOpenLicensedAudio(payload, dependencies) {
  const { app, completedDownloads } = dependencies;
  const identifier = String(payload && payload.identifier || '');
  const fileName = String(payload && payload.fileName || '');
  if (!isSafeArchiveIdentifier(identifier)) throw new Error('Invalid Internet Archive item identifier.');
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || !isAudioFilename(fileName)) {
    throw new Error('Choose a direct audio file from the Internet Archive search results.');
  }
  const item = await getArchiveItem(identifier, { fetchImpl: dependencies.fetchImpl, timeoutMs: 30000 });
  if (!item.licenseLabel) throw new Error('Sleeve will only download Internet Archive items that declare a supported Creative Commons or public-domain license.');
  if (String(item.metadata.mediatype || '').toLowerCase() !== 'audio') throw new Error('This Internet Archive item is not marked as audio.');
  const file = mapAudioFiles(item.json.files).find((entry) => entry.name === fileName);
  if (!file) throw new Error('That audio file is no longer listed as a downloadable item. Refresh the search and try again.');
  if (file.size > MAX_AUDIO_BYTES) throw new Error('This file exceeds Sleeve’s 300 MB in-app audio-download limit.');

  const root = getDownloadsRoot(app);
  await fs.promises.mkdir(root, { recursive: true });
  const destination = await uniqueDestination(root, file.name);
  const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
  const response = await safeArchiveFetch(url, { fetchImpl: dependencies.fetchImpl, timeoutMs: 60000 });
  if (!response.ok) throw new Error(`The audio file could not be downloaded (HTTP ${response.status || 'unknown'}).`);
  const contentType = String(response.headers && response.headers.get ? response.headers.get('content-type') : '').toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/json') || contentType.includes('text/plain')) throw new Error('Internet Archive returned a web page instead of an audio file. Check the item’s download permissions.');
  const announcedSize = Number(response.headers && response.headers.get ? response.headers.get('content-length') : 0);
  if (announcedSize > MAX_AUDIO_BYTES) throw new Error('The server reports a file larger than Sleeve’s 300 MB in-app limit.');
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); }
  catch (_) { throw new Error('The audio download was interrupted. Try again.'); }
  if (!bytes.length) throw new Error('The downloaded file was empty.');
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error('The downloaded audio exceeds Sleeve’s 300 MB in-app limit.');
  const preview = bytes.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  if (preview.startsWith('<!doctype html') || preview.startsWith('<html') || preview.startsWith('<head') || preview.startsWith('{"error"')) {
    throw new Error('Internet Archive returned a web page instead of an audio file. Check the item’s download permissions.');
  }
  await fs.promises.writeFile(destination, bytes, { flag: 'wx' });
  completedDownloads.add(path.resolve(destination));
  return {
    path: path.resolve(destination),
    name: path.basename(destination),
    size: bytes.length,
    licenseUrl: item.licenseUrl,
    licenseLabel: item.licenseLabel,
    source: 'Internet Archive'
  };
}

async function resolveAndDownloadOpenLicensedAudio(payload, dependencies) {
  const match = await resolveOpenLicensedTrack(payload, { fetchImpl: dependencies.fetchImpl });
  if (!match) throw new Error('No reliable, explicitly open-licensed audio match was found for this track. Sleeve left it as not found rather than choosing an uncertain copy.');
  const downloaded = await downloadOpenLicensedAudio({ identifier: match.item.identifier, fileName: match.file.name }, dependencies);
  return {
    ...downloaded,
    trackTitle: safeText(payload && (payload.title || payload.name), 180),
    trackArtist: safeText(payload && (payload.artist || payload.artistText), 180),
    matchedItemTitle: match.item.title,
    matchedCreator: match.item.creator,
    matchScore: Math.round(match.score * 100),
    matchTitleScore: Math.round(match.titleScore * 100),
    matchArtistScore: Math.round(match.artistScore * 100)
  };
}

async function crc32File(filePath) {
  let crc = 0xFFFFFFFF;
  for await (const chunk of fs.createReadStream(filePath)) {
    for (let i = 0; i < chunk.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ chunk[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function writeStreamChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      stream.removeListener('drain', onDrain);
      stream.removeListener('error', onError);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function writeZipArchive(files, destination) {
  if (!Array.isArray(files) || !files.length) throw new Error('No successful audio downloads are available to package.');
  if (files.length > MAX_COLLECTION_TRACKS) throw new Error(`A ZIP can contain at most ${MAX_COLLECTION_TRACKS} audio tracks.`);
  let totalBytes = 0;
  for (const file of files) {
    const stat = await fs.promises.stat(file.path);
    if (!stat.isFile() || !isAudioFilename(file.path)) throw new Error('Sleeve can only package verified audio files.');
    if (stat.size <= 0 || stat.size > MAX_AUDIO_BYTES) throw new Error(`The audio file ${path.basename(file.path)} is empty or exceeds the per-track limit.`);
    totalBytes += stat.size;
    if (totalBytes > MAX_COLLECTION_ZIP_BYTES) throw new Error('The matching audio exceeds the 480 MB ZIP limit. Download fewer tracks or use smaller formats.');
  }

  const tempPath = `${destination}.partial-${process.pid}-${Date.now()}`;
  const output = fs.createWriteStream(tempPath, { flags: 'wx' });
  const centralEntries = [];
  let offset = 0;
  const seenNames = new Set();
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const stat = await fs.promises.stat(file.path);
      let baseName = sanitizeFileName(file.zipName || file.name || path.basename(file.path));
      const ext = path.extname(baseName);
      const stem = path.basename(baseName, ext);
      baseName = `${String(index + 1).padStart(2, '0')} - ${stem}${ext}`;
      let zipName = baseName;
      let suffix = 2;
      while (seenNames.has(zipName.toLowerCase())) zipName = `${String(index + 1).padStart(2, '0')} - ${stem} (${suffix++})${ext}`;
      seenNames.add(zipName.toLowerCase());
      const nameBytes = Buffer.from(zipName, 'utf8');
      if (nameBytes.length > 65535 || offset > 0xFFFFFFFF) throw new Error('The ZIP contains a filename or archive size beyond the supported ZIP limit.');
      const checksum = await crc32File(file.path);
      const localOffset = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034B50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0x21, 12);
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(stat.size, 18);
      local.writeUInt32LE(stat.size, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      local.writeUInt16LE(0, 28);
      await writeStreamChunk(output, local);
      await writeStreamChunk(output, nameBytes);
      offset += local.length + nameBytes.length;
      for await (const chunk of fs.createReadStream(file.path)) {
        await writeStreamChunk(output, chunk);
        offset += chunk.length;
      }
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014B50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(0, 12);
      central.writeUInt16LE(0x21, 14);
      central.writeUInt32LE(checksum, 16);
      central.writeUInt32LE(stat.size, 20);
      central.writeUInt32LE(stat.size, 24);
      central.writeUInt16LE(nameBytes.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(localOffset, 42);
      centralEntries.push({ central, nameBytes });
    }
    const centralOffset = offset;
    let centralSize = 0;
    for (const item of centralEntries) {
      await writeStreamChunk(output, item.central);
      await writeStreamChunk(output, item.nameBytes);
      offset += item.central.length + item.nameBytes.length;
      centralSize += item.central.length + item.nameBytes.length;
    }
    if (centralEntries.length > 65535 || centralOffset > 0xFFFFFFFF || centralSize > 0xFFFFFFFF) throw new Error('The ZIP exceeds standard ZIP format limits.');
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054B50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(centralEntries.length, 8);
    eocd.writeUInt16LE(centralEntries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    eocd.writeUInt16LE(0, 20);
    await writeStreamChunk(output, eocd);
    output.end();
    await new Promise((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
    });
    await fs.promises.rename(tempPath, destination);
    return { path: path.resolve(destination), name: path.basename(destination), size: offset + eocd.length, trackCount: files.length };
  } catch (error) {
    try { output.destroy(); } catch (_) {}
    try { await fs.promises.rm(tempPath, { force: true }); } catch (_) {}
    throw error;
  }
}

async function downloadOpenAudioCollection(payload, dependencies) {
  const requestId = safeText(payload && payload.requestId, 100);
  const rawTracks = payload && payload.tracks;
  if (!Array.isArray(rawTracks) || !rawTracks.length) throw new Error('Load a playlist or album with tracks before starting a download.');
  if (rawTracks.length > MAX_COLLECTION_TRACKS) throw new Error(`Sleeve currently supports ZIP downloads up to ${MAX_COLLECTION_TRACKS} tracks per collection.`);
  const jobs = dependencies.collectionJobs || new Map();
  const job = { cancelled: false };
  if (requestId) jobs.set(requestId, job);
  const report = (phase, processed, total, message) => {
    if (typeof dependencies.onCollectionProgress === 'function') {
      try { dependencies.onCollectionProgress({ requestId, phase, processed, total, message }); } catch (_) {}
    }
  };
  const isCancelled = () => job.cancelled;
  const statuses = rawTracks.map((raw, index) => ({
    index: Number.isInteger(raw && raw.sourceIndex) ? raw.sourceIndex : index,
    title: safeText(raw && (raw.title || raw.name), 180) || `Track ${index + 1}`,
    artist: safeText(raw && (raw.artist || raw.artistText), 180),
    album: safeText(raw && (raw.album || raw.albumName), 180),
    isrc: (() => { try { return core.cleanIsrc(raw && raw.isrc); } catch (_) { return ''; } })(),
    status: 'pending',
    message: ''
  }));
  try {
    let resolveStarted = 0;
    await mapWithLimit(statuses, 2, async (state, index) => {
      if (isCancelled()) {
        state.status = 'cancelled';
        state.message = 'Cancelled before resolving.';
        return state;
      }
      if (!state.artist) {
        state.status = 'not-found';
        state.message = 'Artist metadata is missing, so Sleeve skipped an uncertain match.';
        return state;
      }
      resolveStarted += 1;
      report('resolving', resolveStarted, statuses.length, `Resolving track ${index + 1} of ${statuses.length}: ${state.title}`);
      try {
        const match = await resolveOpenLicensedTrack({
          title: state.title,
          artist: state.artist,
          album: state.album,
          isrc: state.isrc
        }, { fetchImpl: dependencies.fetchImpl, maxCandidates: 10, metadataConcurrency: 2 });
        if (isCancelled()) {
          state.status = 'cancelled';
          state.message = 'Cancelled after resolving; no download was started.';
        } else if (!match) {
          state.status = 'not-found';
          state.message = 'No sufficiently confident explicitly open-licensed match was found.';
        } else if (!Number.isFinite(Number(match.file.size)) || Number(match.file.size) <= 0) {
          state.status = 'size-unknown';
          state.message = 'A candidate matched, but the source did not report its file size, so it was skipped in the safe ZIP workflow.';
        } else {
          state.match = match;
          state.status = 'matched';
          state.message = `${Math.round(match.score * 100)}% match confidence · ${match.item.licenseLabel}${match.exactIsrc ? ' · exact ISRC' : ''}`;
        }
      } catch (error) {
        state.status = 'error';
        state.message = safeText(error && error.message, 220) || 'Source search failed.';
      }
      return state;
    });
    let plannedBytes = 0;
    const planned = [];
    for (const state of statuses) {
      if (isCancelled()) { if (state.status === 'matched') { state.status = 'cancelled'; state.message = 'Cancelled before download.'; } continue; }
      if (state.status !== 'matched') continue;
      const size = Number(state.match.file.size);
      if (plannedBytes + size > MAX_COLLECTION_ZIP_BYTES) {
        state.status = 'size-limit';
        state.message = 'Skipped to keep the collection ZIP under 480 MB.';
        continue;
      }
      plannedBytes += size;
      planned.push(state);
    }
    const downloaded = [];
    const successfulDownloads = [];
    let packagedBytes = 0;
    let downloadCompleted = 0;
    await mapWithLimit(planned, 2, async (state, index) => {
      if (isCancelled()) {
        state.status = 'cancelled';
        state.message = 'Cancelled before downloading.';
        return state;
      }
      try {
        const result = await downloadOpenLicensedAudio({
          identifier: state.match.item.identifier,
          fileName: state.match.file.name
        }, dependencies);
        state.download = result;
        state.status = 'downloaded-pending-zip';
        state.message = `${result.name} · ${result.licenseLabel}`;
      } catch (error) {
        state.status = 'error';
        state.message = safeText(error && error.message, 220) || 'Download failed.';
      } finally {
        downloadCompleted += 1;
        report('downloading', downloadCompleted, planned.length, `Downloaded ${downloadCompleted} of ${planned.length} planned tracks…`);
      }
      return state;
    });
    const usedZipNames = new Set();
    for (const state of planned) {
      if (!state.download) continue;
      const result = state.download;
      if (packagedBytes + result.size <= MAX_COLLECTION_ZIP_BYTES) {
        packagedBytes += result.size;
        state.status = 'downloaded';
        state.includedInZip = true;
        state.message = `${result.name} · ${result.licenseLabel}`;
        const ext = path.extname(result.name);
        const zipStem = sanitizeFileName(state.title || path.basename(result.name, ext));
        let zipName = `${zipStem}${ext}`;
        let duplicateIndex = 2;
        while (usedZipNames.has(zipName.toLowerCase())) zipName = `${zipStem} (${duplicateIndex++})${ext}`;
        usedZipNames.add(zipName.toLowerCase());
        downloaded.push({ path: result.path, name: result.name, zipName, state });
      } else {
        state.status = 'downloaded-not-zipped';
        state.message = 'Downloaded and can be imported, but omitted from the ZIP to keep it under 480 MB.';
      }
    }
    let zip = null;
    let zipError = '';
    if (downloaded.length) {
      report('packaging', downloaded.length, downloaded.length, `Packaging ${downloaded.length} eligible download${downloaded.length === 1 ? '' : 's'} into a ZIP…`);
      try {
        const root = getDownloadsRoot(dependencies.app);
        const rawName = safeText(payload && payload.collectionName, 120) || 'Sleeve Collection';
        const zipPath = await uniqueDestination(root, `${sanitizeFileName(rawName)}.zip`);
        zip = await writeZipArchive(downloaded, zipPath);
      } catch (error) {
        zipError = safeText(error && error.message, 220) || 'Could not create a ZIP archive.';
        for (const entry of downloaded) {
          entry.state.status = 'downloaded-not-zipped';
          entry.state.includedInZip = false;
          entry.state.message = `Downloaded and available to import, but ZIP packaging failed: ${zipError}`;
        }
        downloaded.splice(0, downloaded.length);
      }
    }
    const results = statuses.map((state) => ({
      index: state.index,
      title: state.title,
      artist: state.artist,
      status: state.status,
      message: state.message,
      path: state.download ? state.download.path : '',
      name: state.download ? state.download.name : '',
      licenseLabel: state.download ? state.download.licenseLabel : (state.match && state.match.item.licenseLabel) || '',
      matchScore: state.match ? Math.round(state.match.score * 100) : null,
      includedInZip: Boolean(state.download && state.includedInZip)
    }));
    const matchedCount = statuses.filter((state) => ['matched', 'downloaded', 'downloaded-not-zipped'].includes(state.status) || state.download).length;
    const notFoundCount = statuses.filter((state) => state.status === 'not-found').length;
    report('complete', statuses.length, statuses.length, zip
      ? `Finished: packaged ${downloaded.length} audio tracks; ${notFoundCount} track${notFoundCount === 1 ? '' : 's'} not found.`
      : 'Finished, but there were no successfully downloaded tracks to package.');
    return {
      requestId,
      collectionName: safeText(payload && payload.collectionName, 120) || 'Sleeve Collection ' + (zip ? ' (packaged)' : ''),
      results,
      zipPath: zip ? zip.path : '',
      zipName: zip ? zip.name : '',
      zipSize: zip ? zip.size : 0,
      downloadedCount: successfulDownloads.length,
      packagedCount: downloaded.length,
      notFoundCount,
      matchedCount,
      note: zip
        ? `Packaged ${downloaded.length} track${downloaded.length === 1 ? '' : 's'} for which Sleeve found a sufficiently confident, explicitly open-licensed downloadable match. The source files are also saved separately in Sleeve Downloads.`
        : (successfulDownloads.length
          ? `Downloaded ${successfulDownloads.length} eligible audio file${successfulDownloads.length === 1 ? '' : 's'}, but no ZIP was created${zipError ? `: ${zipError}` : ''}. The individual files are available in Sleeve Downloads.`
          : 'No eligible tracks were downloaded. Sleeve leaves uncertain or unavailable matches as not found.')
    };
  } finally {
    if (requestId) jobs.delete(requestId);
  }
}

function registerFindMusicHandlers({ ipcMain, shell }) {
  // This is a placeholder for the main handler registration
  // to prevent crashes during startup.
  return { registered: true };
}

function registerFindMusicDownloadHandlers({ ipcMain, app, BrowserWindow }) {
  if (!ipcMain || !app) throw new TypeError('ipcMain and app are required');
  const completedDownloads = new Set();
  const collectionJobs = new Map();
  const dependencies = { app, completedDownloads, collectionJobs };

  function emitCollectionProgress(payload) {
    if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') return;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) continue;
      try { win.webContents.send('find-music:open-audio-collection-progress', payload); } catch (_) {}
    }
  }
  dependencies.onCollectionProgress = emitCollectionProgress;

  ipcMain.handle('find-music:search-open-audio', async (_event, payload) => searchOpenLicensedAudio(payload));
  ipcMain.handle('find-music:download-open-audio', async (_event, payload) => downloadOpenLicensedAudio(payload, dependencies));
  ipcMain.handle('find-music:resolve-download-open-audio', async (_event, payload) => resolveAndDownloadOpenLicensedAudio(payload, dependencies));
  ipcMain.handle('find-music:download-open-audio-collection', async (_event, payload) => downloadOpenAudioCollection(payload, dependencies));
  ipcMain.handle('find-music:cancel-open-audio-collection', async (_event, requestId) => {
    const job = collectionJobs.get(safeText(requestId, 100));
    if (job) job.cancelled = true;
    return { cancelled: Boolean(job) };
  });
  ipcMain.handle('find-music:read-downloaded-file', async (_event, filePath) => readCompletedDownload(filePath, dependencies));

  return { completedDownloads, collectionJobs, searchOpenLicensedAudio, downloadOpenLicensedAudio, resolveOpenLicensedTrack, downloadOpenAudioCollection };
}

function initFindMusicDownloadUI() {
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('fmOpenAudioSection')) return;

  const api = window.electronAPI;
  const overlay = document.getElementById('sleeveFindMusicOverlay');
  const content = overlay && overlay.querySelector('.find-music-content');
  if (!api || !content || typeof api.findMusicSearchOpenAudio !== 'function') {
    console.warn('[Sleeve Find Music] Local music download API is missing. Run the updated installer.');
    return;
  }

  const section = document.createElement('section');
  section.id = 'fmOpenAudioSection';
  section.className = 'find-music-card find-music-open-audio-card';
  section.innerHTML = `
    <div class="find-music-section-heading">
      <div>
        <h3>4. Download eligible music directly in Sleeve</h3>
        <p>Search Internet Archive for audio with an explicitly declared Creative Commons or public-domain license. Use the in-app Download &amp; add button for a direct audio file; no embedded browser is used.</p>
      </div>
    </div>
    <div class="find-music-open-audio-actions">
      <button id="fmSearchOpenAudio" class="find-music-primary" type="button">Search downloadable music</button>
      <span id="fmOpenAudioCount" class="find-music-count">No search yet</span>
    </div>
    <div id="fmOpenAudioFeedback" class="find-music-status" role="status" aria-live="polite">Directly downloaded audio is saved in Music → Sleeve Downloads and added to your library automatically.</div>
    <div id="fmOpenAudioResults" class="find-music-open-audio-results" hidden></div>
    <p class="find-music-watch-note">Only files offered by the source are downloaded. Sleeve doesn’t rip streams. Internet Archive license metadata is supplied by uploaders, so check each item’s rights information; no result is a guarantee that every underlying recording was uploaded correctly.</p>
  `;
  const footnote = content.querySelector('.find-music-footnote');
  const importCard = content.querySelector('.find-music-import-card');
  if (importCard) content.insertBefore(section, importCard);
  else if (footnote) content.insertBefore(section, footnote);
  else content.appendChild(section);

  const get = (id) => document.getElementById(id);
  const feedback = get('fmOpenAudioFeedback');
  const results = get('fmOpenAudioResults');
  const count = get('fmOpenAudioCount');
  const searchButton = get('fmSearchOpenAudio');
  let searching = false;
  let operationEpoch = 0;
  const importingDownloadedPaths = new Set();

  async function importDownloadedPath(filePath) {
    if (!filePath || importingDownloadedPaths.has(filePath)) return false;
    importingDownloadedPaths.add(filePath);
    try {
      const record = await api.findMusicReadDownloadedFile(filePath);
      if (!record || !record.bytes || typeof record.name !== 'string') {
        throw new Error('Sleeve received an invalid downloaded file.');
      }
      const file = new File([record.bytes], record.name, {
        type: record.type || 'application/octet-stream',
        lastModified: Number(record.lastModified) || Date.now()
      });
      Object.defineProperty(file, '__sleeveSourcePath', { value: record.path, enumerable: false });
      window.dispatchEvent(new CustomEvent('sleeve:find-music-import-files', { detail: { files: [file] } }));
      return true;
    } finally {
      importingDownloadedPaths.delete(filePath);
    }
  }

  async function downloadFile(item, file, button) {
    if (button.disabled) return;
    const actionEpoch = operationEpoch;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Downloading and importing…';
    setStatus(`Downloading ${file.name} from Internet Archive.`, 'info');
    try {
      const downloaded = await api.findMusicDownloadOpenAudio({ identifier: item.identifier, fileName: file.name });
      await importDownloadedPath(downloaded.path);
      if (actionEpoch === operationEpoch && !overlay.hidden) {
        setStatus(`Downloaded and added “${downloaded.name}” to Sleeve. Saved under Music → Sleeve Downloads. License listed by source: ${downloaded.licenseLabel}.`, 'success');
        button.textContent = 'Downloaded ✓';
      }
    } catch (error) {
      if (actionEpoch === operationEpoch && !overlay.hidden) {
        setStatus(error && error.message ? error.message : 'The download failed. Try another file or source.', 'error');
        button.textContent = oldText;
        button.disabled = false;
      }
    }
  }

  function renderResults(items) {
    results.replaceChildren();
    count.textContent = `${items.length} downloadable item${items.length === 1 ? '' : 's'}`;
    if (!items.length) {
      results.appendChild(makeText('div', 'find-music-empty', 'No explicitly licensed, directly downloadable audio items matched. Try a shorter title, the artist name alone, or another source below.'));
      results.hidden = false;
      return;
    }

    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'find-music-open-audio-result';
      const header = document.createElement('div');
      header.className = 'find-music-open-audio-result-header';
      const heading = document.createElement('div');
      heading.className = 'find-music-open-audio-result-heading';
      heading.appendChild(makeText('h4', '', item.title || 'Untitled audio item'));
      heading.appendChild(makeText('p', '', [item.creator, item.year].filter(Boolean).join(' · ') || 'Creator or date not supplied'));
      const license = makeText('span', 'find-music-license-pill', item.licenseLabel || 'License metadata unavailable');
      header.append(heading, license);
      card.appendChild(header);

      const fileList = document.createElement('div');
      fileList.className = 'find-music-open-audio-files';
      for (const file of Array.isArray(item.files) ? item.files : []) {
        const row = document.createElement('div');
        row.className = 'find-music-open-audio-file';
        const fileDetails = document.createElement('div');
        fileDetails.className = 'find-music-open-audio-file-details';
        fileDetails.appendChild(makeText('strong', '', file.name));
        fileDetails.appendChild(makeText('small', '', prettyFileFormat(file)));
        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'find-music-secondary';
        download.textContent = 'Download & add';
        download.addEventListener('click', () => downloadFile(item, file, download));
        row.append(fileDetails, download);
        fileList.appendChild(row);
      }
      card.appendChild(fileList);
      const sourceNote = makeText('p', 'find-music-source-note', `Direct source: ${item.itemUrl || 'Internet Archive'} · License URL: ${item.licenseUrl || 'not supplied'}`);
      card.appendChild(sourceNote);
      results.appendChild(card);
    }
    results.hidden = false;
  }

  function makeText(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    return element;
  }

  async function searchOpenAudio() {
    if (searching) return;
    const searchEpoch = operationEpoch;
    const title = document.getElementById('fmTitle')?.value.trim() || '';
    const artist = document.getElementById('fmArtist')?.value.trim() || '';
    const album = document.getElementById('fmAlbum')?.value.trim() || '';
    if (!title && !artist) {
    setStatus('Enter a title or artist in step 1 first.', 'error');
    return;
    }
    searching = true;
    searchButton.disabled = true;
    searchButton.textContent = 'Searching open-license catalog…';
    count.textContent = 'Searching…';
    results.hidden = true;
    results.replaceChildren();
    setStatus('Searching Internet Archive metadata and verifying each item’s declared license and audio files.', 'info');
    try {
      const response = await api.findMusicSearchOpenAudio({ title, artist, album });
      if (searchEpoch !== operationEpoch || overlay.hidden) {
        return;
      }
      renderResults(response.results || []);
      setStatus(response.note || 'Search complete.', 'info');
    } catch (error) {
      if (searchEpoch !== operationEpoch || overlay.hidden) {
        return;
      }
      count.textContent = 'Search failed';
      }
    } finally {
      if (searchEpoch === operationEpoch) {
        searching = false;
        searchButton.disabled = false;
        searchButton.textContent = 'Search downloadable music';
      }
    }
  }

  searchButton.addEventListener('click', searchOpenAudio);

  document.addEventListener('sleeve:find-music-reset', () => {
    operationEpoch += 1;
    searching = false;
    results.replaceChildren();
    results.hidden = true;
    count.textContent = 'No search yet';
    setStatus('Directly downloaded audio is saved in Music → Sleeve Downloads and added to your library automatically.', 'info');
    searchButton.disabled = false;
    searchButton.textContent = 'Search downloadable music';
  });
}

module.exports = {
  initFindMusicDownloadUI
};
