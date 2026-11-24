'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { LocalNetworkService } = require('../services/local-network-service');

test('local network host exposes info and pairs an authorized device', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sleeve-network-test-'));
  const service = new LocalNetworkService({ userDataPath, deviceName: 'Sleeve Test Host' });

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
    await service.stopHost();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
