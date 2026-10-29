'use strict';
const assert = require('node:assert/strict');
const pub = require('./find-music-public-metadata-main');

const ok = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

(async () => {
  const normal = pub.youtubeReference('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk');
  assert.equal(normal.type, 'video');
  assert.equal(normal.id, 'dQw4w9WgXcQ');
  assert.equal(normal.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(normal.playlistId, 'PLabcdefghijk');
  assert.equal(pub.youtubeReference('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(pub.youtubeReference('https://music.youtube.com/playlist?list=PLabcdefghijk').type, 'playlist');
  assert.throws(() => pub.youtubeReference('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), /YouTube/i);
  assert.throws(() => pub.youtubeReference('http://youtube.com/watch?v=dQw4w9WgXcQ'), /HTTPS/i);
  assert.deepEqual(pub.parseYouTubeTrackTitle('M.I.A. - Paper Planes (Official Music Video)', 'M.I.A. - Topic'), {
    title: 'Paper Planes', artist: 'M.I.A.', originalTitle: 'M.I.A. - Paper Planes (Official Music Video)'
  });
  assert.equal(pub.parseYouTubeTrackTitle('Paper Planes - M.I.A. (Official Audio)', 'M.I.A.').title, 'Paper Planes');

  const playlist = await pub.resolvePublicYouTubeLink({ url: 'https://www.youtube.com/playlist?list=PLabcdefghijk' }, {
    fetchImpl: async () => { throw new Error('playlist handling must not try to fetch video oEmbed'); }
  });
  assert.equal(playlist.requiresCsv, true);
  assert.match(playlist.message, /CSV track list/i);

  const queue = [
    { title: 'M.I.A. - Paper Planes (Official Music Video)', author_name: 'M.I.A. - Topic', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
    { resultCount: 2, results: [
      { wrapperType: 'track', kind: 'song', trackId: 1, collectionId: 101, trackName: 'Paper Planes', artistName: 'M.I.A.', collectionName: 'Kala', trackTimeMillis: 205000, trackNumber: 5, artworkUrl100: 'https://is.example/cover.jpg' },
      { wrapperType: 'track', kind: 'song', trackId: 2, collectionId: 202, trackName: 'Paper Planes', artistName: 'Another Artist', collectionName: 'Other Album', trackTimeMillis: 205000 }
    ] }
  ];
  const result = await pub.resolvePublicLink({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, {
    fetchImpl: async (url) => {
      assert.ok(url.startsWith('https://www.youtube.com/oembed?') || url.startsWith('https://itunes.apple.com/search?'));
      return ok(queue.shift());
    }
  });
  assert.equal(result.kind, 'track');
  assert.equal(result.sourceService, 'YouTube');
  assert.equal(result.track.title, 'Paper Planes');
  assert.equal(result.track.artist, 'M.I.A.');
  assert.match(result.message, /will not download or extract YouTube audio/i);

  console.log('YouTube reference integration tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
