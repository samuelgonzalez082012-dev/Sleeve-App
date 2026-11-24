'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchTasteArtists } = require('../find-music-main');

test('discovers artists for up to three unique genre tags', async () => {
  const requests = [];
  const response = await searchTasteArtists({ genres: ['Rock', 'Jazz', 'rock', '', 'Pop'] }, {
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      const genre = requests.at(-1).url.searchParams.get('query');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          artists: [{
            id: `mbid-${requests.length}`,
            name: `Artist ${requests.length}`,
            score: 97,
            type: 'Group',
            area: { name: 'United States' },
            'life-span': { begin: '2012' },
            disambiguation: 'Test artist'
          }]
        })
      };
    },
    minIntervalMs: 0,
    maxRetries: 0,
    timeoutMs: 1000
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(response.genres.map((group) => group.genre), ['Rock', 'Jazz', 'Pop']);
  assert.equal(response.resultCount, 3);
  assert.equal(response.genres[0].artists[0].name, 'Artist 1');
  assert.equal(response.genres[0].artists[0].country, 'United States');
  assert.match(response.genres[0].artists[0].musicBrainzUrl, /musicbrainz\.org\/artist\/mbid-1$/);
  assert.equal(requests[0].url.searchParams.get('query'), 'tag:"Rock"');
  assert.equal(requests[0].options.headers['User-Agent'].startsWith('Sleeve/'), true);
});

test('rejects empty discovery genre input', async () => {
  await assert.rejects(
    () => searchTasteArtists({ genres: [' ', '', null] }, { minIntervalMs: 0 }),
    /at least one known genre/
  );
});

test('limits discovery requests to three genres and de-duplicates case-insensitively', async () => {
  let calls = 0;
  const response = await searchTasteArtists({ genres: ['Indie', 'indie', 'Electronic', 'Jazz', 'Metal'] }, {
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ artists: [] }) };
    },
    minIntervalMs: 0,
    maxRetries: 0,
    timeoutMs: 1000
  });
  assert.equal(calls, 3);
  assert.deepEqual(response.genres.map((group) => group.genre), ['Indie', 'Electronic', 'Jazz']);
});
