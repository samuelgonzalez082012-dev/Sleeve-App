'use strict';

const assert = require('node:assert/strict');
const {
  isTransientStatus,
  parseRetryAfterMs,
  requestMusicBrainzJson,
  searchArtistCatalog,
  getArtistDiscography,
  mapReleaseGroup
} = require('./find-music-main');

(async () => {
  for (const status of [429, 500, 502, 503, 504]) assert.equal(isTransientStatus(status), true);
  for (const status of [200, 400, 401, 403, 404]) assert.equal(isTransientStatus(status), false);

  assert.equal(parseRetryAfterMs({ headers: { get: () => '2' } }), 2000);
  assert.equal(parseRetryAfterMs({ headers: { get: () => null } }), 0);

  let calls = 0;
  const fakeFetch = async (_url, options) => {
    calls += 1;
    assert.equal(options.headers['User-Agent'].startsWith('Sleeve/'), true);
    if (calls === 1) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => null }
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ recordings: [{ id: 'test-recording' }] })
    };
  };

  const result = await requestMusicBrainzJson('https://musicbrainz.org/ws/2/recording/?query=test', {
    fetchImpl: fakeFetch,
    minIntervalMs: 0,
    retryBaseMs: 0,
    maxRetries: 2,
    timeoutMs: 1000
  });
  assert.equal(calls, 2, '503 response should be retried instead of immediately failing');
  assert.equal(result.recordings[0].id, 'test-recording');

  const artistName = 'Sleeve Discography Test Artist';
  const artistId = '33333333-3333-4333-8333-333333333333';
  const offsets = [];
  let artistSearchCalls = 0;
  const catalogFetch = async (url, options) => {
    assert.equal(options.headers['User-Agent'].startsWith('Sleeve/'), true);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/artist/')) {
      artistSearchCalls += 1;
      assert.equal(parsed.searchParams.get('fmt'), 'json');
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ artists: [
          { id: artistId, name: artistName, score: 100, type: 'Group' },
          { id: '44444444-4444-4444-8444-444444444444', name: 'Sleeve Discography Test Artist (other)', score: 80 }
        ] })
      };
    }
    assert.equal(parsed.pathname.endsWith('/release-group/'), true);
    assert.equal(parsed.searchParams.get('artist'), artistId);
    assert.equal(parsed.searchParams.get('release-group-status'), 'website-default');
    const offset = Number(parsed.searchParams.get('offset') || 0);
    offsets.push(offset);
    const count = 102;
    const size = offset === 0 ? 100 : 2;
    const releaseGroups = Array.from({ length: size }, (_, index) => ({
      id: `release-group-${offset + index}`,
      title: `Catalog Album ${offset + index}`,
      'primary-type': 'Album',
      'secondary-types': offset === 0 && index === 0 ? ['Compilation', 'Live'] : [],
      'first-release-date': '2020-01-01',
      count: 1
    }));
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ 'release-group-count': count, 'release-groups': releaseGroups })
    };
  };

  const artistSearch = await searchArtistCatalog({ artistName }, {
    fetchImpl: catalogFetch, minIntervalMs: 0, timeoutMs: 1000
  });
  assert.equal(artistSearch.artists.length, 2);
  assert.equal(artistSearch.artists[0].exactName, true);
  assert.equal(artistSearch.artists[0].id, artistId);
  await searchArtistCatalog({ artistName, forceRefresh: true }, {
    fetchImpl: catalogFetch, minIntervalMs: 0, timeoutMs: 1000
  });
  assert.equal(artistSearchCalls, 2, 'forceRefresh should bypass the artist search cache');

  const discography = await getArtistDiscography({ artistId }, {
    fetchImpl: catalogFetch, minIntervalMs: 0, timeoutMs: 1000
  });
  assert.deepEqual(offsets, [0, 100], 'release-group browse should page using the number of returned results');
  assert.equal(discography.totalCount, 102);
  assert.equal(discography.fetchedCount, 102);
  assert.equal(discography.truncated, false);
  assert.equal(discography.releaseGroups.length, 102);
  assert.deepEqual(discography.releaseGroups[0].secondaryTypes, ['Compilation', 'Live']);
  assert.ok(discography.releaseGroups[0].coverArtUrl.includes('coverartarchive.org/release-group/'));
  await getArtistDiscography({ artistId, forceRefresh: true }, {
    fetchImpl: catalogFetch, minIntervalMs: 0, timeoutMs: 1000
  });
  assert.deepEqual(offsets, [0, 100, 0, 100], 'forceRefresh should bypass the discography cache');

  const mappedRelease = mapReleaseGroup({
    id: artistId, title: 'Mapped Release', 'primary-type': 'EP',
    'secondary-types': ['Live'], 'first-release-date': '2001-02-03'
  });
  assert.equal(mappedRelease.primaryType, 'EP');
  assert.equal(mappedRelease.firstReleaseDate, '2001-02-03');
  await assert.rejects(
    getArtistDiscography({ artistId: 'not-a-valid-mbid' }),
    /valid MusicBrainz artist/
  );
  console.log('Find Music MusicBrainz retry and artist discography tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
