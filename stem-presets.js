'use strict';

(function attachSleeveStemPresets(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SleeveStemPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStemPresetCore() {
  const STEM_NAMES = Object.freeze(['drums', 'vocals', 'bass', 'guitar', 'piano', 'other']);
  const STEM_VOLUME_MAX = 2.5;
  const ORIGINAL = Object.freeze({ drums: 1, vocals: 1, bass: 1, guitar: 1, piano: 1, other: 1 });
  const BUILT_IN_PRESETS = Object.freeze([
    Object.freeze({ id: 'original', name: 'Original', isBuiltIn: true, volumes: ORIGINAL }),
    Object.freeze({ id: 'acapella', name: 'Acapella', isBuiltIn: true, volumes: Object.freeze({ drums: 0, vocals: 1, bass: 0, guitar: 0, piano: 0, other: 0 }) }),
    Object.freeze({ id: 'instrumental', name: 'Instrumental', isBuiltIn: true, volumes: Object.freeze({ drums: 1, vocals: 0, bass: 1, guitar: 1, piano: 1, other: 1 }) }),
    Object.freeze({ id: 'vocal-focus', name: 'Vocal Focus', isBuiltIn: true, volumes: Object.freeze({ drums: 0.65, vocals: 1.5, bass: 0.7, guitar: 0.7, piano: 0.7, other: 0.7 }) }),
    Object.freeze({ id: 'drum-focus', name: 'Drum Focus', isBuiltIn: true, volumes: Object.freeze({ drums: 1.6, vocals: 0.7, bass: 0.75, guitar: 0.7, piano: 0.7, other: 0.7 }) }),
    Object.freeze({ id: 'bass-focus', name: 'Bass Focus', isBuiltIn: true, volumes: Object.freeze({ drums: 0.8, vocals: 0.7, bass: 1.6, guitar: 0.7, piano: 0.7, other: 0.7 }) })
  ]);

  function clampVolume(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(STEM_VOLUME_MAX, number)) : fallback;
  }

  function normalizeVolumes(input, fallback) {
    const base = fallback || ORIGINAL;
    const result = {};
    STEM_NAMES.forEach((name) => { result[name] = clampVolume(input && input[name], base[name]); });
    return result;
  }

  function normalizePreset(record) {
    if (!record || typeof record !== 'object') return null;
    const id = String(record.id || '').trim();
    const name = String(record.name || '').trim().slice(0, 48);
    if (!id || !name || id.length > 120) return null;
    if (BUILT_IN_PRESETS.some((preset) => preset.id === id)) return null;
    return {
      id,
      name,
      isBuiltIn: false,
      volumes: normalizeVolumes(record.volumes),
      createdAt: Number(record.createdAt) || Date.now(),
      updatedAt: Number(record.updatedAt) || Date.now()
    };
  }

  function effectiveGain(volumes, name, state) {
    const settings = state || {};
    if (settings.muted) return 0;
    if (settings.solo && settings.solo !== name) return 0;
    return clampVolume(volumes && volumes[name], 1);
  }

  return Object.freeze({
    STEM_NAMES,
    STEM_VOLUME_MAX,
    ORIGINAL,
    BUILT_IN_PRESETS,
    clampVolume,
    normalizeVolumes,
    normalizePreset,
    effectiveGain
  });
});
