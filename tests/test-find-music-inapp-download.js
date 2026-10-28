'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveOpenLicensedTrack,
  scoreOpenLicensedTrack,
  downloadOpenAudioCollection,
  extractZipAudioBuffers
} = require('./find-music-download-main');

(async () => {
  assert.equal(scoreOpenLicensedTrack(
    { title: 'Test Tune', artist: 'Sample Artist' },
    { title: 'Test Tune', creator: 'Sample Artist', files: [{ name: 'test-tune.mp3' }] },
    { name: '01 - Test Tune.mp3' }
  ).accepted, true);
  assert.equal(scoreOpenLicensedTrack(
    { title: 'Test Tune', artist: 'Sample Artist' },
    { title: 'Different Song', creator: 'Unrelated Band', files: [{ name: 'different-song.mp3' }] },
    { name: 'different-song.mp3' }
  ).accepted, false, 'A weak title/artist candidate must be rejected');

  const requests = [];
  const fakeFetch = async (url, options = {}) => {
    assert.equal(options.redirect, 'manual');
    const parsed = new URL(url);
    requests.push(parsed.href);
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
          metadata: { identifier: 'open-song-1', mediatype: 'audio', title: 'Test Tune', creator: 'Sample Artist', year: '2024', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' },
          files: [{ name: 'test-tune.mp3', format: 'MP3', size: '15' }]
        })
      };
    }
    if (parsed.pathname === '/download/open-song-1/test-tune.mp3') {
      const bytes = Buffer.from('mock-audio-file');
      return {
        ok: true, status: 200,
        headers: { get: (name) => ({ 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) }[String(name).toLowerCase()] || null) },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      };
    }
    throw new Error(`Unexpected test URL: ${parsed.href}`);
  };

  const match = await resolveOpenLicensedTrack({ title: 'Test Tune', artist: 'Sample Artist' }, { fetchImpl: fakeFetch });
  assert.ok(match, 'Should return a single reliable open-license match');
  assert.equal(match.file.name, 'test-tune.mp3');
  assert.ok(Math.round(match.score * 100) >= 95);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleeve-inapp-collection-'));
  try {
    const jobs = new Map();
    const progress = [];
    const result = await downloadOpenAudioCollection({
      requestId: 'job-test-01',
      collectionName: 'Sample Playlist',
      tracks: [{ sourceIndex: 4, title: 'Test Tune', artist: 'Sample Artist', album: 'Sample EP' }]
    }, {
      app: { getPath: () => tempDir },
      completedDownloads: new Set(),
      collectionJobs: jobs,
      fetchImpl: fakeFetch,
      onCollectionProgress: (payload) => progress.push(payload)
    });

    assert.equal(result.downloadedCount, 1);
    assert.equal(result.packagedCount, 1);
    assert.equal(result.results[0].index, 4, 'Original playlist row index is preserved, including duplicate/unavailable rows');
    assert.equal(result.results[0].status, 'downloaded');
    assert.ok(result.zipPath && fs.existsSync(result.zipPath), 'ZIP should be saved locally');
    assert.ok(progress.some((payload) => payload.phase === 'resolving'));
    assert.ok(progress.some((payload) => payload.phase === 'downloading'));
    assert.ok(progress.some((payload) => payload.phase === 'packaging'));

    const entries = extractZipAudioBuffers(fs.readFileSync(result.zipPath));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, '01 - Test Tune.mp3');
    assert.equal(entries[0].bytes.toString('utf8'), 'mock-audio-file');

    const noMatch = await scoreOpenLicensedTrack(
      { title: 'Test Tune', artist: 'Sample Artist' },
      { title: 'Different Song', creator: 'Unrelated Band', files: [{ name: 'different-song.mp3' }] },
      { name: 'different-song.mp3' }
    );
    assert.equal(noMatch.accepted, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('Find Music direct in-app download + collection ZIP tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
