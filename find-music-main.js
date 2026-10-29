'use strict';

const core = require('./find-music-core');

const MUSICBRAINZ_URL = 'https://musicbrainz.org/ws/2/recording/';
const USER_AGENT = 'Sleeve/1.0.2 (https://github.com/samuelgonzalez082012-dev/Sleeve-App)';
const DEFAULT_REQUEST_INTERVAL_MS = 1100;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 1200;
const MAX_AUTOMATIC_RETRY_AFTER_MS = 15000;

let lastMusicBrainzRequestAt = 0;
let musicBrainzQueue = Promise.resolve();
let musicBrainzCooldownUntil = 0;
const successfulSearchCache = new Map();
const inFlightSearches = new Map();
const SEARCH_CACHE_TTL_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function escapeLucene(value) {
  return String(value || '').replace(/[+\-!(){}\[\]^"~*?:\\/]/g, '\\$&').trim();
}

function artistCreditName(credit) {
  if (!Array.isArray(credit)) return '';
  return credit.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    const name = item.name || (item.artist && item.artist.name) || '';
    return `${name}${item.joinphrase || ''}`;
  }).join('').trim();
}

function mapRecording(recording, source) {
  const releases = Array.isArray(recording.releases) ? recording.releases : [];
  const firstRelease = releases[0] || null;
  const candidate = {
    id: recording.id || '',
    title: recording.title || 'Unknown title',
    artist: artistCreditName(recording['artist-credit']) || 'Unknown artist',
    durationSec: Number.isFinite(recording.length) ? recording.length / 1000 : null,
    isrcs: Array.isArray(recording.isrcs) ? recording.isrcs : [],
    album: firstRelease && firstRelease.title ? firstRelease.title : '',
    releaseDate: (firstRelease && firstRelease.date) || recording['first-release-date'] || '',
    disambiguation: recording.disambiguation || '',
    musicBrainzUrl: recording.id ? `https://musicbrainz.org/recording/${encodeURIComponent(recording.id)}` : ''
  };
  const match = core.scoreRecording(source, candidate);
  return { ...candidate, matchScore: match.score, exactIsrc: match.exactIsrc, matchComponents: match.components };
}

function isTransientStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function parseRetryAfterMs(response) {
  try {
    const value = response && response.headers && response.headers.get
      ? response.headers.get('retry-after')
      : null;
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  } catch (_) {
    // Some test doubles and non-standard fetch implementations omit Headers.
  }
  return 0;
}

function rateLimitError(waitMs, status) {
  const waitSeconds = Math.max(1, Math.ceil(Number(waitMs || 15000) / 1000));
  const statusText = status ? ` (HTTP ${status})` : '';
  return new Error(
    `MusicBrainz is temporarily busy or rate-limiting requests${statusText}. Sleeve is respecting a cooldown. Wait about ${waitSeconds} seconds, then try again.`
  );
}

function isRetryableNetworkError(error) {
  return Boolean(error && (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    error.name === 'TypeError' ||
    /network|fetch failed|timed? ?out|temporar/i.test(String(error.message || ''))
  ));
}

async function requestMusicBrainzJsonQueued(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? Math.max(0, options.minIntervalMs) : DEFAULT_REQUEST_INTERVAL_MS;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const maxRetries = Number.isInteger(options.maxRetries) ? Math.max(0, options.maxRetries) : DEFAULT_MAX_RETRIES;
  const retryBaseMs = Number.isFinite(options.retryBaseMs) ? Math.max(0, options.retryBaseMs) : DEFAULT_RETRY_BASE_MS;

  if (typeof fetchImpl !== 'function') throw new Error('This version of Node/Electron does not provide fetch. Update Electron or enable a supported fetch implementation.');

  if (musicBrainzCooldownUntil > Date.now()) {
    throw rateLimitError(musicBrainzCooldownUntil - Date.now());
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const waitForSlot = Math.max(0, minIntervalMs - (Date.now() - lastMusicBrainzRequestAt));
    if (waitForSlot) await sleep(waitForSlot);
    lastMusicBrainzRequestAt = Date.now();

    let response;
    try {
      const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
      response = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        ...(signal ? { signal } : {})
      });
    } catch (error) {
      if (attempt < maxRetries && isRetryableNetworkError(error)) {
        await sleep(Math.min(8000, retryBaseMs * (2 ** attempt)));
        continue;
      }
      if (isRetryableNetworkError(error)) {
        musicBrainzCooldownUntil = Date.now() + 5000;
        throw new Error('MusicBrainz could not be reached after automatic retries. Check your internet connection, wait a few seconds, and try again.');
      }
      throw error;
    }

    if (response && response.ok) {
      musicBrainzCooldownUntil = 0;
      try {
        return await response.json();
      } catch (_) {
        throw new Error('MusicBrainz responded, but its response was not valid JSON. Try again in a moment.');
      }
    }

    const status = response && Number(response.status) || 0;
    if (isTransientStatus(status)) {
      const retryAfterMs = parseRetryAfterMs(response);
      if (attempt < maxRetries && retryAfterMs <= MAX_AUTOMATIC_RETRY_AFTER_MS) {
        const backoffMs = Math.min(8000, retryBaseMs * (2 ** attempt));
        await sleep(Math.max(backoffMs, retryAfterMs));
        continue;
      }

      const cooldownMs = Math.max(15000, retryAfterMs);
      musicBrainzCooldownUntil = Date.now() + cooldownMs;
      throw rateLimitError(cooldownMs, status);
    }

    throw new Error(`MusicBrainz request failed (HTTP ${status || 'unknown'}). Check your connection and try again.`);
  }

  // The loop always returns or throws, but keep this branch explicit for static analysis.
  throw new Error('MusicBrainz search failed after automatic retries. Please try again later.');
}

function requestMusicBrainzJson(url, options = {}) {
  // Serialize requests across all renderer windows so concurrent searches can't
  // accidentally exceed MusicBrainz's public API request rate.
  const task = musicBrainzQueue.catch(() => {}).then(() => requestMusicBrainzJsonQueued(url, options));
  musicBrainzQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function performSearch({ query, title, artist, album, durationSec, isrc, preference }) {
  const params = new URLSearchParams({ query, fmt: 'json', limit: '12', inc: 'isrcs+releases+artist-credits' });
  const json = await requestMusicBrainzJson(`${MUSICBRAINZ_URL}?${params.toString()}`);
  const recordings = Array.isArray(json.recordings) ? json.recordings : [];
  const source = { title, artist, album, durationSec, isrc };
  const results = recordings.map((recording) => mapRecording(recording, source));
  results.sort((a, b) => Number(b.exactIsrc) - Number(a.exactIsrc) || b.matchScore - a.matchScore);
  return {
    query,
    results,
    providerLinks: core.makeProviderLinks({ title, artist, album }, preference)
  };
}

async function searchMusicBrainz(payload) {
  const title = String(payload.title || '').trim().slice(0, 240);
  const artist = String(payload.artist || '').trim().slice(0, 240);
  const album = String(payload.album || '').trim().slice(0, 240);
  const durationSec = Number(payload.durationSec) || null;
  const isrc = core.cleanIsrc(payload.isrc || '');
  const preference = String(payload.preference || 'free');

  if (!isrc && !title) {
    throw new Error('Enter a track title or a valid ISRC before searching.');
  }
  if (!isrc && !artist) {
    throw new Error('Enter the artist name to improve match accuracy.');
  }

  let query;
  if (isrc) {
    query = `isrc:${isrc}`;
  } else {
    const terms = [`recording:"${escapeLucene(title)}"`];
    if (artist) terms.push(`artist:"${escapeLucene(artist)}"`);
    if (album) terms.push(`release:"${escapeLucene(album)}"`);
    query = terms.join(' AND ');
  }

  const cacheKey = JSON.stringify({ query, durationSec, isrc, preference });
  const now = Date.now();
  const cached = successfulSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) successfulSearchCache.delete(cacheKey);
  if (inFlightSearches.has(cacheKey)) return inFlightSearches.get(cacheKey);

  const promise = performSearch({ query, title, artist, album, durationSec, isrc, preference })
    .then((result) => {
      successfulSearchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, value: result });
      if (successfulSearchCache.size > 40) {
        const oldestKey = successfulSearchCache.keys().next().value;
        if (oldestKey !== undefined) successfulSearchCache.delete(oldestKey);
      }
      return result;
    })
    .finally(() => inFlightSearches.delete(cacheKey));
  inFlightSearches.set(cacheKey, promise);
  return promise;
}

function registerFindMusicHandlers({ ipcMain, shell }) {
  if (!ipcMain || !shell) throw new TypeError('ipcMain and shell are required');

  ipcMain.handle('find-music:parse-link', async (_event, rawUrl) => {
    return core.parseReferenceLink(rawUrl);
  });

  ipcMain.handle('find-music:search-recordings', async (_event, payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid search request.');
    return searchMusicBrainz(payload);
  });

  ipcMain.handle('find-music:open-url', async (_event, rawUrl) => {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.protocol !== 'https:' || !core.isAllowedHost(parsed.hostname)) {
      throw new Error('Sleeve blocked opening an untrusted external URL.');
    }
    await shell.openExternal(parsed.href);
    return { opened: true };
  });
}

module.exports = {
  registerFindMusicHandlers,
  searchMusicBrainz,
  mapRecording,
  artistCreditName,
  escapeLucene,
  isTransientStatus,
  parseRetryAfterMs,
  requestMusicBrainzJson
};
