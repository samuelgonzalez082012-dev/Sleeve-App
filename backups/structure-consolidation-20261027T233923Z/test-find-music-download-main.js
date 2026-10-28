'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  isArchiveHost,
  isSafeArchiveIdentifier,
  isExplicitlyOpenLicense,
  licenseLabel,
  isAudioFilename,
  sanitizeFileName,
  searchOpenLicensedAudio,
  extractZipAudioBuffers,
  crc32,
  downloadOpenLicensedAudio
} = require('./find-music-download-main');


function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.bytes);
    const compressed = zlib.deflateRawSync(raw);
    const checksum = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

(async () => {
  assert.equal(isArchiveHost('archive.org'), true);
  assert.equal(isArchiveHost('ia801.us.archive.org'), true);
  assert.equal(isArchiveHost('notarchive.org'), false);
  assert.equal(isSafeArchiveIdentifier('artist_album-2024'), true);
  assert.equal(isSafeArchiveIdentifier('../outside'), false);
  assert.equal(isExplicitlyOpenLicense('https://creativecommons.org/licenses/by/4.0/'), true);
  assert.equal(isExplicitlyOpenLicense('http://creativecommons.org/licenses/by-nc/3.0/'), true);
  assert.equal(isExplicitlyOpenLicense('https://example.com/free'), false);
  assert.equal(licenseLabel('https://creativecommons.org/licenses/by-nc-nd/4.0/'), 'Creative Commons BY-NC-ND 4.0');
  assert.equal(licenseLabel('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0 1.0 Public Domain Dedication');
  assert.equal(isAudioFilename('song.FLAC'), true);
  assert.equal(isAudioFilename('receipt.pdf'), false);
  assert.equal(sanitizeFileName('../../CON.mp3').includes('..'), false);

  const zip = makeZip([
    { name: 'Album/01 - Song.mp3', bytes: Buffer.from('ID3 test data') },
    { name: 'Album/cover.jpg', bytes: Buffer.from('image data') },
    { name: '../escape.flac', bytes: Buffer.from('bad path') }
  ]);
  const extracted = extractZipAudioBuffers(zip);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].name, '01 - Song.mp3');
  assert.deepEqual(extracted[0].bytes, Buffer.from('ID3 test data'));

  let requests = 0;
  const fakeFetch = async (url, options = {}) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(isArchiveHost(new URL(url).hostname), true);
    requests += 1;
    const parsed = new URL(url);
    if (parsed.pathname === '/advancedsearch.php') {
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        json: async () => ({ response: { docs: [{ identifier: 'open-song-1', title: 'Test Tune', creator: 'Sample Artist', mediatype: 'audio' }] } })
      };
    }
    if (parsed.pathname === '/metadata/open-song-1') {
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        json: async () => ({
          metadata: { identifier: 'open-song-1', mediatype: 'audio', title: 'Test Tune', creator: 'Sample Artist', year: '2023', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' },
          files: [{ name: 'test-tune.mp3', format: 'MP3', size: '12' }]
        })
      };
    }
    if (parsed.pathname === '/download/open-song-1/test-tune.mp3') {
      const bytes = Buffer.from('mock-audio-bytes');
      return {
        ok: true, status: 200,
        headers: { get: (name) => ({ 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) }[String(name).toLowerCase()] || null) },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const search = await searchOpenLicensedAudio({ title: 'Test Tune', artist: 'Sample Artist' }, { fetchImpl: fakeFetch });
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].licenseLabel, 'Creative Commons BY 4.0');
  assert.equal(search.results[0].files[0].name, 'test-tune.mp3');
  assert.equal(requests, 2);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleeve-download-test-'));
  try {
    const downloads = new Set();
    const result = await downloadOpenLicensedAudio({ identifier: 'open-song-1', fileName: 'test-tune.mp3' }, {
      app: { getPath: () => tempDir },
      completedDownloads: downloads,
      fetchImpl: fakeFetch
    });
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(downloads.has(result.path), true);
    assert.equal(fs.readFileSync(result.path, 'utf8'), 'mock-audio-bytes');
    assert.equal(result.licenseLabel, 'Creative Commons BY 4.0');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('Find Music in-app download tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
