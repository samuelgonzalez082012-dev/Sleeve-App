'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, findDuplicateGroups } = require('./duplicate-detection.js');

test('normalization handles case, punctuation, and extension consistently', () => {
  assert.equal(normalize('Rise Above This.MP3'), 'rise above this');
  assert.equal(normalize('  BÉYONCÉ—Live  '), 'béyoncé live');
});
test('same title, artist, and close duration are grouped', () => {
  const tracks = [
    {id:1,title:'Duality.mp3',artist:'Slipknot',duration:252},
    {id:2,title:'duality',artist:'SLIPKNOT',duration:253.2},
    {id:3,title:'Duality',artist:'Other Band',duration:252}
  ];
  const groups = findDuplicateGroups(tracks);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].tracks.map(t=>t.id), [1,2]);
});
test('duration mismatch avoids grouping studio and live versions', () => {
  const groups = findDuplicateGroups([
    {id:1,title:'Song',artist:'Artist',duration:180},
    {id:2,title:'Song',artist:'Artist',duration:240}
  ]);
  assert.equal(groups.length, 0);
});
test('untagged tracks need same normalized title and file size', () => {
  const groups = findDuplicateGroups([
    {id:1,title:'Track.wav',size:1000},
    {id:2,title:'track',size:1000},
    {id:3,title:'track',size:1200}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].tracks.map(t=>t.id), [1,2]);
});
test('ignored keys suppress groups without mutating the library', () => {
  const tracks = [{id:1,title:'Same',size:99},{id:2,title:'same.mp3',size:99}];
  const group = findDuplicateGroups(tracks)[0];
  assert.equal(findDuplicateGroups(tracks, new Set([group.key])).length, 0);
  assert.equal(tracks.length, 2);
});
test('missing titles and missing ids are ignored safely', () => {
  assert.deepEqual(findDuplicateGroups([{}, {id:1,title:''}, {title:'no id',size:4}]), []);
});

test('ignoring one duration cluster does not hide another version group', () => {
  const tracks = [
    {id:1,title:'Song',artist:'Artist',duration:180},
    {id:2,title:'Song',artist:'Artist',duration:181},
    {id:3,title:'Song',artist:'Artist',duration:240},
    {id:4,title:'Song',artist:'Artist',duration:241}
  ];
  const groups = findDuplicateGroups(tracks);
  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].key, groups[1].key);
  assert.equal(findDuplicateGroups(tracks, new Set([groups[0].key])).length, 1);
});
