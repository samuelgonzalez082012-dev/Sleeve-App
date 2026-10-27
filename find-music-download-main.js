'use strict';

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
  // If the exact title+creator query returns nothing, retry with less restrictive
  // public metadata queries. Confidence scoring below remains the final gate.
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

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function getDownloadsRoot(app) {
  let musicPath = '';
  try { musicPath = app.getPath('music'); } catch (_) {}
  if (!musicPath) musicPath = app.getPath('downloads');
  return path.join(musicPath, 'Sleeve Downloads');
}

function uniqueDestinationSync(directory, fileName, reservedPaths = new Set()) {
  const safe = sanitizeFileName(fileName);
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext);
  let candidate = path.join(directory, safe);
  let index = 2;
  while (fs.existsSync(candidate) || reservedPaths.has(path.resolve(candidate))) candidate = path.join(directory, `${stem} (${index++})${ext}`);
  return candidate;
}

async function uniqueDestination(directory, fileName) {
  const safe = sanitizeFileName(fileName);
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext);
  let candidate = path.join(directory, safe);
  let index = 2;
  while (true) {
    try { await fs.promises.access(candidate); }
    catch (_) { return candidate; }
    candidate = path.join(directory, `${stem} (${index++})${ext}`);
  }
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
  if (contentType.includes('text/html') || contentType.includes('application/json')) throw new Error('Internet Archive returned a web page instead of an audio file. Check the item’s download permissions.');
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

function findZipEndRecord(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  for (let index = buffer.length - 22; index >= min; index -= 1) {
    if (buffer.readUInt32LE(index) !== 0x06054B50) continue;
    const commentLength = buffer.readUInt16LE(index + 20);
    if (index + 22 + commentLength === buffer.length) return index;
  }
  return -1;
}

function listSafeZipAudioEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('The downloaded ZIP archive is invalid.');
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('This album ZIP is larger than Sleeve’s 500 MB in-app extraction limit.');
  const eocd = findZipEndRecord(buffer);
  if (eocd < 0) throw new Error('Sleeve could not find the ZIP directory. The archive may be damaged or use an unsupported ZIP64 format.');
  const entriesCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entriesCount === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) {
    throw new Error('This ZIP uses ZIP64, which this version of Sleeve cannot extract automatically. The archive is saved in Sleeve Downloads.');
  }
  if (entriesCount > MAX_ZIP_ENTRIES || centralOffset + centralSize > buffer.length) {
    throw new Error('This ZIP directory is outside Sleeve’s safe extraction limits. The archive is saved in Sleeve Downloads.');
  }
  const entries = [];
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entriesCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014B50) {
      throw new Error('Sleeve found an invalid ZIP entry. The archive is saved in Sleeve Downloads.');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttrs = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) throw new Error('Sleeve found a truncated ZIP entry. The archive is saved in Sleeve Downloads.');
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    offset = end;
    if (!rawName || rawName.endsWith('/') || rawName.startsWith('/') || /^[A-Za-z]:/.test(rawName) || rawName.split('/').includes('..')) continue;
    const unixMode = externalAttrs >>> 16;
    if ((unixMode & 0xF000) === 0xA000) continue; // symbolic link
    if (!isAudioFilename(rawName)) continue;
    if ((flags & 0x0001) !== 0) continue; // encrypted files aren't extracted
    if (![0, 8].includes(method)) continue;
    if ([compressedSize, uncompressedSize, localOffset].includes(0xFFFFFFFF)) {
      throw new Error('This ZIP entry uses unsupported ZIP64 sizes. The archive is saved in Sleeve Downloads.');
    }
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error('An audio track in this ZIP exceeds Sleeve’s 300 MB extraction limit. The archive is saved in Sleeve Downloads.');
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_AUDIO_TOTAL_BYTES) throw new Error('The ZIP expands to over 1 GB of audio. The archive is saved in Sleeve Downloads.');
    entries.push({ rawName, name: sanitizeFileName(path.posix.basename(rawName)), method, crc, compressedSize, uncompressedSize, localOffset });
  }
  return entries;
}

function extractZipEntryBuffer(zipBuffer, entry) {
  const local = entry.localOffset;
  if (local + 30 > zipBuffer.length || zipBuffer.readUInt32LE(local) !== 0x04034B50) {
    throw new Error(`Sleeve found a damaged ZIP entry for ${entry.name}. The archive is saved in Sleeve Downloads.`);
  }
  const localNameLength = zipBuffer.readUInt16LE(local + 26);
  const localExtraLength = zipBuffer.readUInt16LE(local + 28);
  const dataStart = local + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > zipBuffer.length || dataStart > dataEnd) {
    throw new Error(`Sleeve found a truncated ZIP entry for ${entry.name}. The archive is saved in Sleeve Downloads.`);
  }
  const compressed = zipBuffer.subarray(dataStart, dataEnd);
  let data;
  try {
    data = entry.method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
  } catch (_) {
    throw new Error(`Sleeve could not extract ${entry.name} from the ZIP. The archive is saved in Sleeve Downloads.`);
  }
  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) {
    throw new Error(`The ZIP integrity check failed for ${entry.name}. The archive is saved in Sleeve Downloads.`);
  }
  return data;
}

function extractZipAudioBuffers(zipBuffer) {
  return listSafeZipAudioEntries(zipBuffer).map((entry) => ({ name: entry.name, bytes: extractZipEntryBuffer(zipBuffer, entry) }));
}

async function extractZipToSleeveDownloads(zipPath, app) {
  const root = getDownloadsRoot(app);
  const zipBuffer = await fs.promises.readFile(zipPath);
  const entries = listSafeZipAudioEntries(zipBuffer);
  if (!entries.length) return [];
  const folderName = sanitizeFileName(`${path.basename(zipPath, path.extname(zipPath))} - extracted`);
  let outputDir = path.join(root, folderName);
  let suffix = 2;
  while (true) {
    try { await fs.promises.access(outputDir); outputDir = path.join(root, `${folderName} (${suffix++})`); }
    catch (_) { break; }
  }
  await fs.promises.mkdir(outputDir, { recursive: true });
  const written = [];
  for (const entry of entries) {
    const bytes = extractZipEntryBuffer(zipBuffer, entry);
    const destination = await uniqueDestination(outputDir, entry.name);
    await fs.promises.writeFile(destination, bytes, { flag: 'wx' });
    written.push({ path: path.resolve(destination), name: path.basename(destination), size: bytes.length });
  }
  return written;
}

async function readCompletedDownload(rawPath, dependencies) {
  const filePath = path.resolve(String(rawPath || ''));
  const root = getDownloadsRoot(dependencies.app);
  if (!dependencies.completedDownloads.has(filePath) || !isPathInside(root, filePath) || !isAudioFilename(filePath)) {
    throw new Error('Sleeve only imports audio files that it has just downloaded through an approved Find Music flow.');
  }
  const realPath = await fs.promises.realpath(filePath);
  if (!isPathInside(root, realPath) || !isAudioFilename(realPath)) throw new Error('Sleeve blocked a download path outside its music-download folder.');
  const stat = await fs.promises.stat(realPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUDIO_BYTES) throw new Error('This downloaded file is empty or exceeds Sleeve’s 300 MB import limit.');
  const buffer = await fs.promises.readFile(realPath);
  if (buffer.length !== stat.size) throw new Error('The downloaded file changed while Sleeve was reading it. Try again.');
  dependencies.completedDownloads.delete(filePath);
  return {
    path: realPath,
    name: path.basename(realPath),
    type: mimeForAudioPath(realPath),
    lastModified: stat.mtimeMs,
    bytes: Uint8Array.from(buffer)
  };
}

function mimeForAudioPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ({
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wave': 'audio/wav',
    '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
    '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac',
    '.flac': 'audio/flac', '.alac': 'audio/mp4', '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff', '.ape': 'audio/ape', '.wv': 'audio/wavpack',
    '.dsf': 'audio/dsd', '.dff': 'audio/dsd', '.mpc': 'audio/musepack',
    '.mid': 'audio/midi', '.midi': 'audio/midi'
  })[ext] || 'application/octet-stream';
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xEDB88320 : 0);
    table[i] = value >>> 0;
  }
  return table;
}
const CRC_TABLE = buildCrcTable();
// The faster table-based implementation overrides the tiny reference form above.
function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function cleanTrackFileTitle(rawName) {
  let title = path.basename(String(rawName || ''), path.extname(String(rawName || '')));
  title = title.replace(/^\s*\d{1,3}(?:[._\s-]+)+/, '');
  return core.baseTitle(title);
}

function scoreOpenLicensedTrack(track, item, file) {
  const requestedTitle = safeText(track && (track.title || track.name), 180);
  const requestedArtist = safeText(track && (track.artist || track.artistText), 180);
  const requestedAlbum = safeText(track && (track.album || track.albumName), 180);
  const requestedIsrc = (() => { try { return core.cleanIsrc(track && track.isrc); } catch (_) { return ''; } })();
  const sourceIsrc = (() => { try { return core.cleanIsrc(item && item.isrc); } catch (_) { return ''; } })();
  const exactIsrc = Boolean(requestedIsrc && sourceIsrc && requestedIsrc === sourceIsrc);
  if (!requestedTitle || !requestedArtist || !item || !file) return null;

  const fileTitle = cleanTrackFileTitle(file.name);
  let titleScore = core.similarity(core.baseTitle(requestedTitle), fileTitle);
  // An item's title may stand in for its only audio file. Never use an album title
  // as a proxy for one track when the item contains multiple audio files.
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
      local.writeUInt16LE(0x0800, 6); // UTF-8 filename, no data descriptor/encryption
      local.writeUInt16LE(0, 8); // already-compressed audio: store without recompression
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0x21, 12); // 1980-01-01 DOS date
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
    // Resolve two tracks at a time, selecting exactly one confident candidate per track.
    // The renderer only sees a status for each requested track, not a stack of alternatives.
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

    // Keep source order and enforce the aggregate ZIP limit using advertised sizes.
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

    // ZIP entry order follows the original track order, regardless of the order
    // in which the two download workers finish. Keep the advertised ZIP size cap.
    const usedZipNames = new Set();
    for (const state of planned) {
      if (!state.download) continue;
      const result = state.download;
      successfulDownloads.push(state);
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
      collectionName: safeText(payload && payload.collectionName, 120) || 'Sleeve Collection',
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

module.exports = {
  registerFindMusicDownloadHandlers,
  cleanTrackFileTitle,
  isArchiveHost,
  isSafeArchiveIdentifier,
  isExplicitlyOpenLicense,
  licenseLabel,
  isAudioFilename,
  isZipFilename,
  sanitizeFileName,
  archivePhrase,
  mapAudioFiles,
  searchOpenLicensedAudio,
  resolveOpenLicensedTrack,
  scoreOpenLicensedTrack,
  downloadOpenAudioCollection,
  writeZipArchive,
  downloadOpenLicensedAudio,
  readCompletedDownload,
  listSafeZipAudioEntries,
  extractZipAudioBuffers,
  isPathInside,
  safeArchiveFetch,
  crc32
};
