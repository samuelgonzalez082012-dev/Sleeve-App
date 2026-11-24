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
  function normalizeLabel(value) {
    return String(value == null ? '' : value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }
  function cleanLabel(value, fallback) {
    const label = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    return UNKNOWN_LABELS.has(normalizeLabel(label)) ? fallback : label;
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
  function buildBreakdown(tracks, field, fallback, usePlays, limit, now, recentWindowMs) {
    const buckets = new Map();
    for (const track of tracks) {
      const label = cleanLabel(track[field], fallback);
      if (label === fallback) continue;
      const key = normalizeLabel(label);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { name: label, trackCount: 0, plays: 0, tasteWeight: 0, recentTrackCount: 0, latestPlayedAt: 0 }; buckets.set(key, bucket); }
      bucket.trackCount += 1;
      const plays = toCount(track.playCount);
      const lastPlayedAt = toTimestamp(track.lastPlayedAt);
      const age = now - lastPlayedAt;
      const freshness = lastPlayedAt > 0 && age >= 0 && age <= recentWindowMs && recentWindowMs > 0
        ? 1 - (age / recentWindowMs)
        : 0;
      bucket.plays += plays;
      bucket.tasteWeight += usePlays ? plays : 1;
      if (freshness > 0) {
        bucket.recentTrackCount += 1;
        bucket.latestPlayedAt = Math.max(bucket.latestPlayedAt, lastPlayedAt);
        bucket.tasteWeight += 10 * freshness;
      }
    }
    const rows = Array.from(buckets.values());
    const totalWeight = rows.reduce((sum, row) => sum + row.tasteWeight, 0);
    rows.forEach((row) => { row.sharePercent = totalWeight ? Math.round((row.tasteWeight / totalWeight) * 100) : 0; });
    rows.sort((a, b) => b.tasteWeight - a.tasteWeight || b.latestPlayedAt - a.latestPlayedAt || a.name.localeCompare(b.name));
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
    const genres = buildBreakdown(tracks, 'genre', 'Unknown Genre', usePlays, limit, now, recentWindowMs).items;
    const artists = buildBreakdown(tracks, 'artist', 'Unknown Artist', usePlays, limit, now, recentWindowMs).items;
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
  function buildTasteMixTracks(inputTracks, profile, limit, options) {
    const maxTracks = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Math.floor(Number(limit)))) : 25;
    if (!profile) return [];
    const opts = options || {};
    const random = typeof opts.random === 'function' ? opts.random : Math.random;
    const previousTrackIds = new Set(Array.isArray(opts.previousTrackIds) ? opts.previousTrackIds.map(String) : []);
    const sourceTracks = (Array.isArray(inputTracks) ? inputTracks : [])
      .filter((track) => track && track.kind !== 'video' && track.id != null);
    if (!sourceTracks.length) return [];

    // Prefer genre matches, then artist matches. This keeps recommendations
    // useful for libraries with incomplete genre tags instead of returning an
    // empty mix even though the taste profile has strong artist signals.
    let groups = (Array.isArray(profile.genres) ? profile.genres : []).slice(0, 5).map((genre) => ({
      name: cleanLabel(genre && genre.name, 'Unknown Genre'),
      weight: Math.max(1, toCount(genre && genre.sharePercent)),
      field: 'genre'
    })).filter((group) => group.name !== 'Unknown Genre');
    let candidates = groups.flatMap((group) => sourceTracks
      .filter((track) => normalizeLabel(cleanLabel(track.genre, 'Unknown Genre')) === normalizeLabel(group.name))
      .map((track) => ({ track, tasteWeight: group.weight })));

    if (!candidates.length) {
      groups = (Array.isArray(profile.artists) ? profile.artists : []).slice(0, 8).map((artist) => ({
        name: cleanLabel(artist && artist.name, 'Unknown Artist'),
        weight: Math.max(1, toCount(artist && artist.sharePercent)),
        field: 'artist'
      })).filter((group) => group.name !== 'Unknown Artist');
      candidates = groups.flatMap((group) => sourceTracks
        .filter((track) => normalizeLabel(cleanLabel(track.artist, 'Unknown Artist')) === normalizeLabel(group.name))
        .map((track) => ({ track, tasteWeight: group.weight })));
    }

    // Last fallback: use actual listening signals when the library has neither
    // usable genre nor artist tags. Never fabricate taste from unplayed files.
    if (!candidates.length) {
      candidates = sourceTracks.filter((track) => toCount(track.playCount) > 0 || toTimestamp(track.lastPlayedAt) > 0)
        .map((track) => {
          const played = toCount(track.playCount);
          const lastPlayedAt = toTimestamp(track.lastPlayedAt);
          const referenceTime = toTimestamp(profile.generatedAt) || Date.now();
          const ageDays = lastPlayedAt > 0 ? Math.max(0, (referenceTime - lastPlayedAt) / 86400000) : 365;
          return { track, tasteWeight: Math.max(1, played) + (lastPlayedAt > 0 ? 5 / (1 + ageDays / 7) : 0) };
        });
    }
    if (!candidates.length) return [];

    const selected = [];
    const selectedIds = new Set();
    const artistCounts = new Map();
    while (selected.length < maxTracks && candidates.length) {
      let totalWeight = 0;
      const weighted = candidates.map((candidate) => {
        const id = String(candidate.track.id);
        const artist = normalizeLabel(cleanLabel(candidate.track.artist, 'Unknown Artist'));
        const artistCount = artistCounts.get(artist) || 0;
        const repeatPenalty = previousTrackIds.has(id) ? 0.12 : 1;
        const artistPenalty = 1 / (1 + artistCount * 1.5);
        const randomFactor = 0.5 + Math.max(0, Math.min(0.999999, Number(random()) || 0));
        const weight = candidate.tasteWeight * repeatPenalty * artistPenalty * randomFactor;
        totalWeight += weight;
        return { candidate, weight };
      });
      if (!(totalWeight > 0)) break;
      let roll = Math.max(0, Math.min(0.999999, Number(random()) || 0)) * totalWeight;
      let chosen = weighted[weighted.length - 1].candidate;
      for (const item of weighted) {
        roll -= item.weight;
        if (roll <= 0) { chosen = item.candidate; break; }
      }
      const id = String(chosen.track.id);
      const artist = normalizeLabel(cleanLabel(chosen.track.artist, 'Unknown Artist'));
      if (!selectedIds.has(id)) {
        selected.push(chosen.track);
        selectedIds.add(id);
        artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
      }
      const index = candidates.findIndex((candidate) => String(candidate.track.id) === id);
      if (index >= 0) candidates.splice(index, 1);
    }
    return selected;
  }
  return { analyze, buildTasteMixTracks };
});
