'use strict';

const assert = require('node:assert/strict');
const {
  isTransientStatus,
  parseRetryAfterMs,
  requestMusicBrainzJson
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
  console.log('Find Music MusicBrainz retry tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
