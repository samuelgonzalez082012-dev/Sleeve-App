'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { LocalNetworkService } = require('../services/local-network-service');

test('local network host exposes info and pairs an authorized device', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sleeve-network-test-'));
  const audioPath = path.join(userDataPath, 'sample.mp3');
  fs.writeFileSync(audioPath, Buffer.from('0123456789abcdef'));
  const service = new LocalNetworkService({ userDataPath, deviceName: 'Sleeve Test Host' });
  const clientDataPath = path.join(userDataPath, 'client');
  fs.mkdirSync(path.join(clientDataPath, 'network'), { recursive: true });
  let client;
  service.setLibrarySnapshot([
    { id: 12, path: audioPath, title: 'Sample Song', artist: 'Test Artist', album: 'Test Album', genre: 'Ambient', duration: 90, kind: 'audio' }
  ], [{ id: 4, name: 'Test Playlist', type: 'music', trackIds: [12] }]);

  try {
    const status = await service.startHost();
    assert.equal(status.running, true);
    assert.equal(status.deviceName, 'Sleeve Test Host');
    assert.equal(typeof status.port, 'number');
    assert.match(status.pairingCode, /^\d{6}$/);

    const baseUrl = 'http://127.0.0.1:' + status.port;
    const infoResponse = await fetch(baseUrl + '/v1/info');
    assert.equal(infoResponse.status, 200);
    const info = await infoResponse.json();
    assert.equal(info.serverId, status.serverId);
    assert.equal(info.pairingRequired, true);

    const rejected = await fetch(baseUrl + '/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: status.pairingCode === '000000' ? '000001' : '000000', deviceName: 'Unauthorized' })
    });
    assert.equal(rejected.status, 401);

    const pairResponse = await fetch(baseUrl + '/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: status.pairingCode,
        deviceId: '8e1a7b10-20e1-4c22-a2f4-61a1a1d5e777',
        deviceName: 'Test Phone'
      })
    });
    assert.equal(pairResponse.status, 200);
    const paired = await pairResponse.json();
    assert.equal(typeof paired.token, 'string');
    assert.equal(paired.serverId, status.serverId);
    fs.writeFileSync(path.join(clientDataPath, 'network', 'paired-servers.json'), JSON.stringify([{
      serverId: paired.serverId, name: 'Sleeve Test Host', address: '127.0.0.1',
      port: status.port, deviceId: paired.deviceId, token: paired.token
    }]));
    client = new LocalNetworkService({ userDataPath: clientDataPath });
    const remoteTracks = await client.getRemoteLibrary(status.serverId, 'tracks', { q: 'sample' });
    assert.equal(remoteTracks.items[0].title, 'Sample Song');
    const remoteStreamUrl = await client.getRemoteStreamUrl(status.serverId, 12, 'original');
    const remoteRangeResponse = await fetch(remoteStreamUrl, { headers: { range: 'bytes=3-6' } });
    assert.equal(remoteRangeResponse.status, 206);
    assert.equal(Buffer.from(await remoteRangeResponse.arrayBuffer()).toString(), '3456');

    const unauthorizedLibrary = await fetch(baseUrl + '/v1/library');
    assert.equal(unauthorizedLibrary.status, 401);

    const libraryResponse = await fetch(baseUrl + '/v1/library', {
      headers: { authorization: 'Bearer ' + paired.token }
    });
    assert.equal(libraryResponse.status, 200);
    const library = await libraryResponse.json();
    assert.deepEqual(library.counts, { tracks: 1, albums: 1, artists: 1, genres: 1, playlists: 1 });

    const tracksResponse = await fetch(baseUrl + '/v1/library/tracks?q=sample', {
      headers: { authorization: 'Bearer ' + paired.token }
    });
    assert.equal(tracksResponse.status, 200);
    const tracks = await tracksResponse.json();
    assert.equal(tracks.items[0].title, 'Sample Song');
    assert.equal(Object.hasOwn(tracks.items[0], 'path'), false);

    const playlistResponse = await fetch(baseUrl + '/v1/library/playlists/4/tracks', {
      headers: { authorization: 'Bearer ' + paired.token }
    });
    assert.equal(playlistResponse.status, 200);
    assert.equal((await playlistResponse.json()).items.length, 1);

    const rangeResponse = await fetch(baseUrl + '/v1/tracks/12/stream', {
      headers: { authorization: 'Bearer ' + paired.token, range: 'bytes=2-5' }
    });
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get('content-range'), 'bytes 2-5/16');
    assert.equal(Buffer.from(await rangeResponse.arrayBuffer()).toString(), '2345');

    const compactResponse = await fetch(baseUrl + '/v1/tracks/12/stream?quality=compact', {
      headers: { authorization: 'Bearer ' + paired.token }
    });
    assert.equal(compactResponse.status, 503);

    const devicesResponse = await fetch(baseUrl + '/v1/devices', {
      headers: { authorization: 'Bearer ' + paired.token }
    });
    assert.equal(devicesResponse.status, 200);
    const devices = await devicesResponse.json();
    assert.equal(devices.devices.length, 1);
    assert.equal(devices.devices[0].name, 'Test Phone');

    assert.equal(service.revokeDevice(paired.deviceId), true);
    const revokedResponse = await fetch(baseUrl + '/v1/devices', {
      headers: { authorization: 'Bearer ' + paired.token }
    });
    assert.equal(revokedResponse.status, 401);
    assert.equal(service.getStatus().pairedDevices[0].revokedAt !== null, true);
  } finally {
    if (client) await client.stopRemoteProxy();
    await service.stopHost();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
