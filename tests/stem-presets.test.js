'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const presets = require('../stem-presets.js');

test('provides all six required built-in presets', () => {
  assert.deepEqual(presets.BUILT_IN_PRESETS.map((preset) => preset.name), [
    'Original', 'Acapella', 'Instrumental', 'Vocal Focus', 'Drum Focus', 'Bass Focus'
  ]);
  for (const preset of presets.BUILT_IN_PRESETS) {
    assert.deepEqual(Object.keys(preset.volumes).sort(), [...presets.STEM_NAMES].sort());
  }
});

test('normalizes all stem values and clamps them to the mixer range', () => {
  assert.deepEqual(presets.normalizeVolumes({ drums: -2, vocals: 4, bass: '0.5' }), {
    drums: 0, vocals: 2.5, bass: 0.5, guitar: 1, piano: 1, other: 1
  });
});

test('rejects invalid and built-in custom preset records', () => {
  assert.equal(presets.normalizePreset(null), null);
  assert.equal(presets.normalizePreset({ id: 'original', name: 'Override', volumes: {} }), null);
  assert.equal(presets.normalizePreset({ id: 'custom-1', name: '   ', volumes: {} }), null);
  assert.equal(presets.normalizePreset({ id: 'custom-1', name: 'My Mix', volumes: { vocals: 2 } }).volumes.vocals, 2);
});

test('computes mute and solo as temporary effective gain without changing stored volume', () => {
  const volumes = { drums: 1.5, vocals: 0.8, bass: 1, guitar: 1, piano: 1, other: 1 };
  assert.equal(presets.effectiveGain(volumes, 'drums', { muted: true }), 0);
  assert.equal(presets.effectiveGain(volumes, 'vocals', { solo: 'drums' }), 0);
  assert.equal(presets.effectiveGain(volumes, 'drums', { solo: 'drums' }), 1.5);
  assert.equal(volumes.drums, 1.5);
});
