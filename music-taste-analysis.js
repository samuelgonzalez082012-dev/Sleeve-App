/* Sleeve Phase 4.1: deterministic library taste analysis.
 * Reads existing metadata only; it does not persist a duplicate profile or infer missing tags.
 */
(function attachSleeveTasteAnalysis(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SleeveTasteAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTasteAnalysis() {
  'use strict';
  const DEFAULT_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const UNKNOWN_LABELS = new Set(['', 'unknown', 'unknown genre', 'unknown artist', 'n/a', 'none']);
  function cleanLabel(value, fallback) {
    const label = String(value == null ? '' : value).trim();
    return UNKNOWN_LABELS.has(label.toLocaleLowerCase()) ? fallback : label;
  }
  function toCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }
  function toTimestamp(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function buildBreakdown(tracks, field, fallback, usePlays, limit) {
    const buckets = new Map();
    for (const track of tracks) {
      const label = cleanLabel(track[field], fallback);
      if (label === fallback) continue;
      const key = label.toLocaleLowerCase();
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { name: label, trackCount: 0, plays: 0 }; buckets.set(key, bucket); }
      bucket.trackCount += 1;
      bucket.plays += toCount(track.playCount);
    }
    const rows = Array.from(buckets.values());
    const totalWeight = rows.reduce((sum, row) => sum + (usePlays ? row.plays : row.trackCount), 0);
    rows.forEach((row) => { row.sharePercent = totalWeight ? Math.round(((usePlays ? row.plays : row.trackCount) / totalWeight) * 100) : 0; });
    rows.sort((a, b) => (usePlays ? b.plays - a.plays : b.trackCount - a.trackCount) || a.name.localeCompare(b.name));
    return { items: rows.slice(0, limit) };
  }
  function analyze(inputTracks, options) {
    const opts = options || {};
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const recentWindowMs = Number.isFinite(Number(opts.recentWindowMs)) ? Math.max(0, Number(opts.recentWindowMs)) : DEFAULT_RECENT_WINDOW_MS;
    const limit = Number.isFinite(Number(opts.limit)) ? Math.max(1, Math.min(50, Math.floor(Number(opts.limit)))) : 8;
    const tracks = (Array.isArray(inputTracks) ? inputTracks : []).filter((track) => track && track.kind !== 'video');
    const totalPlays = tracks.reduce((sum, track) => sum + toCount(track.playCount), 0);
    const usePlays = totalPlays > 0;
    const genres = buildBreakdown(tracks, 'genre', 'Unknown Genre', usePlays, limit).items;
    const artists = buildBreakdown(tracks, 'artist', 'Unknown Artist', usePlays, limit).items;
    const genreTaggedTrackCount = tracks.filter((track) => cleanLabel(track.genre, 'Unknown Genre') !== 'Unknown Genre').length;
    const artistTaggedTrackCount = tracks.filter((track) => cleanLabel(track.artist, 'Unknown Artist') !== 'Unknown Artist').length;
    const recentlyPlayedTrackCount = tracks.filter((track) => {
      const lastPlayedAt = toTimestamp(track.lastPlayedAt);
      return lastPlayedAt > 0 && lastPlayedAt <= now && (now - lastPlayedAt) <= recentWindowMs;
    }).length;
    const percent = (count) => tracks.length ? Math.round((count / tracks.length) * 100) : 0;
    return {
      generatedAt: now, trackCount: tracks.length, totalPlays,
      rankingBasis: usePlays ? 'plays' : 'track-count',
      recentlyPlayedTrackCount, recentWindowDays: Math.round(recentWindowMs / (24 * 60 * 60 * 1000)),
      metadataCoverage: { genreTaggedTrackCount, genrePercent: percent(genreTaggedTrackCount), artistTaggedTrackCount, artistPercent: percent(artistTaggedTrackCount) },
      genres, artists
    };
  }
  function buildTasteMixTracks(inputTracks, profile, limit) {
    const maxTracks = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Math.floor(Number(limit)))) : 25;
    if (!profile || !Array.isArray(profile.genres) || !profile.genres.length) return [];
    const sourceTracks = (Array.isArray(inputTracks) ? inputTracks : []).filter((track) => track && track.kind !== 'video' && track.id != null);
    const groups = profile.genres.slice(0, 3).map((genre) => {
      const name = cleanLabel(genre && genre.name, 'Unknown Genre');
      const key = name.toLocaleLowerCase();
      const tracks = sourceTracks.filter((track) => cleanLabel(track.genre, 'Unknown Genre').toLocaleLowerCase() === key);
      tracks.sort((a, b) => toCount(b.playCount) - toCount(a.playCount) || toTimestamp(b.addedAt) - toTimestamp(a.addedAt) || String(a.title || '').localeCompare(String(b.title || '')));
      return { name, weight: Math.max(1, toCount(genre && genre.sharePercent)), tracks, picked: 0 };
    }).filter((group) => group.tracks.length);
    const result = [];
    while (result.length < maxTracks) {
      let best = null;
      for (const group of groups) {
        if (group.picked >= group.tracks.length) continue;
        const score = group.weight / (group.picked + 1);
        if (!best || score > best.score) best = { group, score };
      }
      if (!best) break;
      result.push(best.group.tracks[best.group.picked]);
      best.group.picked += 1;
    }
    return result;
  }
  return { analyze, buildTasteMixTracks };
});