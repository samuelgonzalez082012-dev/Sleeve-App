'use strict';
const assert = require('node:assert/strict');
const core = require('./find-music-import-core');

const csv = '\uFEFFTrack URI,Track Name,Artist Name(s),Album Name,Track Duration (ms),ISRC,Album URI\r\n' +
  'spotify:track:1234567890123456789012,"Hello, world",Example Artist,"First, Album",185000,USABC2300001,spotify:album:1234567890123456789012\r\n' +
  'spotify:track:2234567890123456789012,"A ""quoted"" title",Another Artist,Second Album,210000,,spotify:album:2234567890123456789012\r\n';
const parsed = core.parseExportifyCsv(csv, { fileName: 'My Playlist.csv' });
assert.equal(parsed.collectionName, 'My Playlist');
assert.equal(parsed.tracks.length, 2);
assert.equal(parsed.tracks[0].title, 'Hello, world');
assert.equal(parsed.tracks[0].album, 'First, Album');
assert.equal(parsed.tracks[0].durationSec, 185);
assert.equal(parsed.tracks[0].isrc, 'USABC2300001');
assert.equal(parsed.tracks[0].albumUri, 'spotify:album:1234567890123456789012');
assert.equal(parsed.tracks[1].title, 'A "quoted" title');

assert.throws(() => core.parseExportifyCsv('Name,Artist\nOnly title,', { fileName: 'bad.csv' }), /No rows|title and artist/i);
assert.throws(() => core.parseExportifyCsv('Track Name,Album\nSong,Album', {}), /track-title and artist columns/i);
assert.throws(() => core.parseCsvRows('Track Name,Artist\n"Unclosed,Artist'), /unclosed quoted field/i);

const tracks = [
  { sourceIndex: 0, title: 'Hello, world', artist: 'Example Artist', album: 'First Album', durationSec: 185, status: 'pending' },
  { sourceIndex: 1, title: 'Local Song', artist: 'Local Artist', durationSec: 100, status: 'pending' },
  { sourceIndex: 2, title: 'local song', artist: 'Local Artist', durationSec: 100, status: 'pending' }
];
const owned = core.markAlreadyOwned(tracks, [
  { title: 'Hello, world', artist: 'Example Artist', duration: 185 },
  { title: 'Local Song', artist: 'Local Artist', duration: 100 }
]);
assert.equal(owned[0].status, 'already-have');
assert.equal(owned[1].status, 'already-have');
assert.equal(owned[2].status, 'already-have');
const duplicateOnly = core.markAlreadyOwned([
  { title: 'Song A', artist: 'Artist A' }, { title: 'Song A', artist: 'Artist A' }
], []);
assert.equal(duplicateOnly[0].status, 'missing');
assert.equal(duplicateOnly[1].status, 'duplicate-in-playlist');
assert.equal(core.normalizeText('Beyoncé feat. Artist'), 'beyonce feat artist');
console.log('Exportify CSV parsing and library dedupe tests passed.');
