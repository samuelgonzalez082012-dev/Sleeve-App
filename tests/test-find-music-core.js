'use strict';

const assert = require('node:assert/strict');
const core = require('./find-music-core');

assert.deepEqual(
  core.parseReferenceLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=test'),
  {
    service: 'Spotify',
    type: 'track',
    id: '4uLU6hMCjMI75M1A2tKUQC',
    url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=test',
    metadataLookup: 'manual-reference'
  }
);

assert.equal(
  core.parseReferenceLink('spotify:album:1A2B3C4D').id,
  '1A2B3C4D'
);
assert.throws(() => core.parseReferenceLink('https://not-spotify.example/track/123'));
assert.throws(() => core.parseReferenceLink('http://open.spotify.com/track/123'));
assert.equal(core.cleanIsrc('us-abc-23-00001'), 'USABC2300001');
assert.throws(() => core.cleanIsrc('not-an-isrc'));
assert.equal(core.normalizeText('Artist feat. Guest!'), 'artist feat guest');
assert.equal(core.baseTitle('Song Name (2011 Remastered)'), 'song name');
assert.ok(core.similarity('Artist feat. Guest', 'Artist ft Guest') > 0.9);

const score = core.scoreRecording(
  { title: 'Song', artist: 'Artist', album: 'Album', durationSec: 200, isrc: 'USABC2300001' },
  { title: 'Song', artist: 'Artist', album: 'Album', durationSec: 200, isrcs: ['USABC2300001'] }
);
assert.equal(score.exactIsrc, true);
assert.ok(score.score >= 0.97);
assert.ok(core.makeProviderLinks({ title: 'Song', artist: 'Artist' }, 'free')[0].id === 'fma');
assert.ok(core.makeProviderLinks({ title: 'Song', artist: 'Artist' }, 'lossless')[0].id === 'qobuz');
assert.ok(core.makeProviderLinks({ title: 'Song', artist: 'Artist' }, 'all').length >= 5);
const providerLinks = core.makeProviderLinks({ title: 'Song', artist: 'Artist' }, 'all');
assert.ok(providerLinks.every((provider) => typeof provider.searchUrl === 'string'));
assert.ok(providerLinks.every((provider) => !Object.hasOwn(provider, 'url')));
assert.deepEqual(structuredClone(providerLinks), providerLinks, 'IPC payload must be structured-cloneable');

console.log('Find Music core tests passed, including IPC cloneability.');
