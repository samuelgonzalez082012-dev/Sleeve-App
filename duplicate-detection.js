/* Sleeve duplicate detection helpers. CommonJS export for tests; browser-safe API. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SleeveDuplicateDetection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalize(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .replace(/\.[a-z0-9]{1,8}$/i, '')
      .replace(/[’‘`]/g, "'")
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }
  function identity(track) {
    const title = normalize(track && (track.title || track.name || track.file && track.file.name));
    if (!title) return null;
    const artist = normalize(track && track.artist);
    const duration = Number(track && track.duration);
    const size = Number(track && (track.size || track.file && track.file.size));
    // Tagged tracks are matched on title + artist + duration; duration tolerates
    // small container/metadata differences. Untagged tracks require equal file size.
    if (artist && Number.isFinite(duration) && duration > 0) {
      return { key: `tagged|${title}|${artist}`, duration, mode: 'tagged' };
    }
    if (Number.isFinite(size) && size > 0) return { key: `file|${title}|${size}`, duration: 0, mode: 'file' };
    return null;
  }
  function findDuplicateGroups(tracks, ignoredKeys) {
    const ignored = ignoredKeys instanceof Set ? ignoredKeys : new Set(ignoredKeys || []);
    const buckets = new Map();
    for (const track of Array.isArray(tracks) ? tracks : []) {
      if (!track || track.id == null) continue;
      const id = identity(track);
      if (!id) continue;
      const bucket = buckets.get(id.key) || [];
      bucket.push({ track, identity: id });
      buckets.set(id.key, bucket);
    }
    const groups = [];
    for (const [key, entries] of buckets) {
      if (entries.length < 2) continue;
      if (entries[0].identity.mode === 'tagged') {
        // Split groups by duration (within 2.5 seconds), avoiding one title's live/studio versions.
        const clusters = [];
        for (const entry of entries.slice().sort((a, b) => a.identity.duration - b.identity.duration)) {
          let cluster = clusters.find(c => Math.abs(c[0].identity.duration - entry.identity.duration) <= 2.5);
          if (!cluster) clusters.push(cluster = []);
          cluster.push(entry);
        }
        for (const cluster of clusters) if (cluster.length > 1) { const group = makeGroup(key, cluster); if (!ignored.has(group.key)) groups.push(group); }
      } else {
        { const group = makeGroup(key, entries); if (!ignored.has(group.key)) groups.push(group); }
      }
    }
    return groups.sort((a, b) => a.title.localeCompare(b.title));
  }
  function makeGroup(key, entries) {
    const groupKey = entries[0].identity.mode === 'tagged'
      ? key + '|duration:' + Math.round(entries.reduce((sum, e) => sum + e.identity.duration, 0) / entries.length)
      : key;
    return {
      key: groupKey,
      title: String(entries[0].track.title || entries[0].track.name || 'Untitled'),
      artist: String(entries[0].track.artist || ''),
      tracks: entries.map(e => e.track)
    };
  }
  return { normalize, findDuplicateGroups };
});
