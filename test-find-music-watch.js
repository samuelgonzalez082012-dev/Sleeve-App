'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const watch = require('./find-music-watch-main');

async function main() {
  assert.equal(watch.isSupportedAudioFile('track.mp3'), true);
  assert.equal(watch.isSupportedAudioFile('album.FLAC'), true);
  assert.equal(watch.isSupportedAudioFile('download.mp3.crdownload'), false);
  assert.equal(watch.isSupportedAudioFile('cover.jpg'), false);
  assert.equal(watch.isPathInside('/tmp/music', '/tmp/music/sub/song.mp3'), true);
  assert.equal(watch.isPathInside('/tmp/music', '/tmp/music-sibling/song.mp3'), false);
  assert.equal(watch.mimeForPath('song.mp3'), 'audio/mpeg');

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sleeve-find-music-watch-'));
  try {
    await fs.promises.mkdir(path.join(root, 'album'));
    await fs.promises.writeFile(path.join(root, 'song.mp3'), Buffer.from([1, 2, 3]));
    await fs.promises.writeFile(path.join(root, 'album', 'deep.flac'), Buffer.from([4, 5]));
    await fs.promises.writeFile(path.join(root, 'album', 'partial.flac.crdownload'), Buffer.from([6]));
    const entries = await watch.scanAudioFolder(root);
    const names = entries.map((entry) => path.basename(entry.path)).sort();
    assert.deepEqual(names, ['deep.flac', 'song.mp3']);
    assert.equal(entries.every((entry) => entry.size > 0 && Number.isFinite(entry.mtimeMs)), true);

    const cloneable = structuredClone({ bytes: Uint8Array.from([1, 2, 3]), path: entries[0].path });
    assert.deepEqual(Array.from(cloneable.bytes), [1, 2, 3]);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }

  console.log('All download-watcher tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
