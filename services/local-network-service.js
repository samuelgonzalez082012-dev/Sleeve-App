'use strict';

const http = require('node:http');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LocalLibraryStreaming } = require('./local-library-streaming');

const DISCOVERY_PORT = 45831;
const SERVER_PORT = 45832;
const PROTOCOL = 'sleeve-network-v1';
const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PAIR_ATTEMPTS_PER_IP = 8;

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function getLanAddresses() {
  const os = require('node:os');
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

class LocalNetworkService {
  constructor(options = {}) {
    this.userDataPath = options.userDataPath || process.cwd();
    this.deviceName = options.deviceName || 'Sleeve Music Server';
    this.serverId = options.serverId || crypto.randomUUID();
    this.server = null;
    this.discoverySocket = null;
    this.discoveryTimer = null;
    this.port = null;
    this.pairCode = null;
    this.pairCodeExpiresAt = 0;
    this.pairAttempts = new Map();
    this.devicesPath = path.join(this.userDataPath, 'network', 'paired-devices.json');
    this.devices = readJson(this.devicesPath, []);
    if (!Array.isArray(this.devices)) this.devices = [];
    this.libraryStreaming = new LocalLibraryStreaming({ ffmpegPathProvider: options.ffmpegPathProvider });
    this.pairedServersPath = path.join(this.userDataPath, 'network', 'paired-servers.json');
    this.remoteProxyServer = null;
    this.remoteProxyPort = null;
    this.remoteProxySecret = null;
  }

  setLibrarySnapshot(tracks, playlists) {
    return this.libraryStreaming.setSnapshot(tracks, playlists);
  }

  getStatus() {
    return {
      running: Boolean(this.server),
      serverId: this.serverId,
      deviceName: this.deviceName,
      port: this.port,
      addresses: this.server ? getLanAddresses() : [],
      pairingCode: this.server && Date.now() < this.pairCodeExpiresAt ? this.pairCode : null,
      pairingCodeExpiresAt: this.pairCodeExpiresAt || null,
      pairedDevices: this.devices.map(({ id, name, pairedAt, lastSeenAt, revokedAt }) => ({
        id, name, pairedAt, lastSeenAt, revokedAt: revokedAt || null
      }))
    };
  }

  rotatePairingCode() {
    this.pairCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    this.pairCodeExpiresAt = Date.now() + PAIR_CODE_TTL_MS;
    return { code: this.pairCode, expiresAt: this.pairCodeExpiresAt };
  }

  async startHost() {
    if (this.server) return this.getStatus();
    this.rotatePairingCode();
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.requestTimeout = 15000;
    this.server.headersTimeout = 10000;
    this.server.keepAliveTimeout = 5000;

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.removeListener('listening', onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        this.server.removeListener('error', onError);
        this.port = this.server.address().port;
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(SERVER_PORT, '0.0.0.0');
    });

    this.startDiscoveryBroadcast();
    return this.getStatus();
  }

  async stopHost() {
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.discoveryTimer = null;
    if (this.discoverySocket) {
      try { this.discoverySocket.close(); } catch (_) {}
    }
    this.discoverySocket = null;
    this.pairCode = null;
    this.pairCodeExpiresAt = 0;
    const server = this.server;
    this.server = null;
    this.port = null;
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    return this.getStatus();
  }

  startDiscoveryBroadcast() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.discoverySocket = socket;
    socket.on('error', () => {
      try { socket.close(); } catch (_) {}
      if (this.discoverySocket === socket) this.discoverySocket = null;
    });
    socket.on('message', (message, remote) => {
      let packet;
      try { packet = JSON.parse(message.toString('utf8')); } catch (_) { return; }
      if (!packet || packet.protocol !== PROTOCOL || packet.type !== 'discover') return;
      this.sendDiscoveryAnnouncement(remote.address, socket);
    });
    socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      try { socket.setBroadcast(true); } catch (_) {}
      this.sendDiscoveryAnnouncement('255.255.255.255', socket);
      this.discoveryTimer = setInterval(() => {
        this.sendDiscoveryAnnouncement('255.255.255.255', socket);
      }, 3000);
      if (this.discoveryTimer.unref) this.discoveryTimer.unref();
    });
  }

  sendDiscoveryAnnouncement(address, socket = this.discoverySocket) {
    if (!socket || !this.server) return;
    const packet = Buffer.from(JSON.stringify({
      protocol: PROTOCOL,
      type: 'server',
      serverId: this.serverId,
      name: this.deviceName,
      port: this.port,
      version: 1
    }));
    try { socket.send(packet, DISCOVERY_PORT, address); } catch (_) {}
  }

  async discoverServers(timeoutMs = 1800) {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map();
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch (_) {}
        resolve();
      };
      const timer = setTimeout(finish, Math.max(500, Math.min(Number(timeoutMs) || 1800, 5000)));
      socket.on('error', finish);
      socket.on('message', (message, remote) => {
        let packet;
        try { packet = JSON.parse(message.toString('utf8')); } catch (_) { return; }
        if (packet.protocol !== PROTOCOL || packet.type !== 'server' ||
            typeof packet.serverId !== 'string' || !Number.isInteger(packet.port)) return;
        found.set(packet.serverId, {
          serverId: packet.serverId,
          name: String(packet.name || 'Sleeve server').slice(0, 80),
          address: remote.address,
          port: packet.port,
          version: packet.version || 1
        });
      });
      socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
        try { socket.setBroadcast(true); } catch (_) {}
        const query = Buffer.from(JSON.stringify({ protocol: PROTOCOL, type: 'discover' }));
        try { socket.send(query, DISCOVERY_PORT, '255.255.255.255'); } catch (_) {}
      });
      const originalFinish = finish;
      setTimeout(() => { clearTimeout(timer); originalFinish(); }, Math.max(500, Math.min(Number(timeoutMs) || 1800, 5000)) + 30);
    });
    return [...found.values()];
  }

  getPairedServers() {
    const records = readJson(this.pairedServersPath, []);
    return (Array.isArray(records) ? records : []).map(({ serverId, name, address, port, pairedAt }) => ({
      serverId, name, address, port, pairedAt
    }));
  }

  getPairedServer(serverId) {
    const records = readJson(this.pairedServersPath, []);
    return Array.isArray(records) ? records.find(item => item.serverId === serverId && item.token) : null;
  }

  async getRemoteLibrary(serverId, section = 'library', options = {}) {
    const record = this.getPairedServer(serverId);
    if (!record) throw new Error('That Sleeve server is not paired with this device.');
    const allowed = new Set(['library', 'tracks', 'albums', 'artists', 'genres', 'playlists']);
    if (!allowed.has(section)) throw new Error('Unsupported library section.');
    const params = new URLSearchParams();
    for (const key of ['q', 'artist', 'album', 'genre', 'limit', 'offset']) {
      if (options[key] !== undefined && options[key] !== null && String(options[key]).trim()) {
        params.set(key, String(options[key]).slice(0, 160));
      }
    }
    const suffix = section === 'library' ? '/v1/library' : '/v1/library/' + section;
    const url = 'http://' + record.address + ':' + record.port + suffix + (params.size ? '?' + params.toString() : '');
    const response = await fetch(url, {
      headers: { authorization: 'Bearer ' + record.token },
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load the shared library.');
    return data;
  }

  async getRemotePlaylistTracks(serverId, playlistId, options = {}) {
    const record = this.getPairedServer(serverId);
    if (!record) throw new Error('That Sleeve server is not paired with this device.');
    const id = String(playlistId || '');
    if (!/^[-A-Za-z0-9_]{1,40}$/.test(id)) throw new Error('Invalid playlist identifier.');
    const params = new URLSearchParams();
    for (const key of ['limit', 'offset']) if (options[key] != null) params.set(key, String(options[key]));
    const url = 'http://' + record.address + ':' + record.port + '/v1/library/playlists/' + id + '/tracks' + (params.size ? '?' + params.toString() : '');
    const response = await fetch(url, { headers: { authorization: 'Bearer ' + record.token }, signal: AbortSignal.timeout(12000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load that shared playlist.');
    return data;
  }

  async getRemoteStreamUrl(serverId, trackId, quality = 'original') {
    const record = this.getPairedServer(serverId);
    if (!record) throw new Error('That Sleeve server is not paired with this device.');
    if (!/^\\d+$/.test(String(trackId)) || !['original', 'compact'].includes(quality)) {
      throw new Error('Invalid remote track or quality setting.');
    }
    if (!this.remoteProxyServer) {
      this.remoteProxySecret = crypto.randomBytes(24).toString('hex');
      this.remoteProxyServer = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const match = /^\\/([a-f0-9]{48})\\/([a-f0-9-]{36})\\/tracks\\/(\\d+)\\/stream$/.exec(url.pathname);
        if (req.method !== 'GET' || !match || !safeEqualText(match[1], this.remoteProxySecret)) {
          res.writeHead(404); return res.end();
        }
        const paired = this.getPairedServer(match[2]);
        if (!paired) { res.writeHead(403); return res.end(); }
        const streamQuality = url.searchParams.get('quality') || 'original';
        if (!['original', 'compact'].includes(streamQuality)) { res.writeHead(400); return res.end(); }
        const target = new URL('http://' + paired.address + ':' + paired.port + '/v1/tracks/' + match[3] + '/stream');
        target.searchParams.set('quality', streamQuality);
        if (streamQuality === 'compact' && url.searchParams.has('start')) {
          target.searchParams.set('start', String(Math.max(0, Math.min(86400, Number(url.searchParams.get('start')) || 0))));
        }
        const upstream = http.request(target, {
          method: 'GET',
          headers: {
            authorization: 'Bearer ' + paired.token,
            ...(req.headers.range && streamQuality === 'original' ? { range: req.headers.range } : {})
          }
        }, remote => {
          const headers = {};
          for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
            if (remote.headers[name]) headers[name] = remote.headers[name];
          }
          res.writeHead(remote.statusCode || 502, headers);
          remote.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
        req.on('aborted', () => upstream.destroy());
        res.on('close', () => upstream.destroy());
        upstream.end();
      });
      this.remoteProxyServer.on('error', () => { this.remoteProxyServer = null; this.remoteProxyPort = null; });
      await new Promise((resolve, reject) => {
        this.remoteProxyServer.once('error', reject);
        this.remoteProxyServer.listen(0, '127.0.0.1', () => {
          this.remoteProxyServer.removeListener('error', reject);
          this.remoteProxyPort = this.remoteProxyServer.address().port;
          resolve();
        });
      });
    }
    return 'http://127.0.0.1:' + this.remoteProxyPort + '/' + this.remoteProxySecret + '/' + serverId + '/tracks/' + trackId + '/stream?quality=' + quality;
  }

  async stopRemoteProxy() {
    if (!this.remoteProxyServer) return;
    const server = this.remoteProxyServer;
    this.remoteProxyServer = null;
    this.remoteProxySecret = null;
    this.remoteProxyPort = null;
    await new Promise(resolve => server.close(() => resolve()));
  }

  async pairWithServer(payload = {}) {
    const address = String(payload.address || '').trim();
    const port = Number(payload.port);
    const code = String(payload.code || '').trim();
    const name = String(payload.deviceName || 'Sleeve device').trim().slice(0, 80);
    if (!address || !Number.isInteger(port) || port < 1 || port > 65535 || !/^\d{6}$/.test(code)) {
      throw new Error('Choose a discovered Sleeve server and enter its current six-digit pairing code.');
    }
    const response = await fetch('http://' + address + ':' + port + '/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceId: crypto.randomUUID(), deviceName: name }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.token) throw new Error(result.error || 'Could not pair with this Sleeve server.');
    const paired = readJson(path.join(this.userDataPath, 'network', 'paired-servers.json'), []);
    const record = {
      serverId: result.serverId,
      name: result.serverName || 'Sleeve server',
      address,
      port,
      deviceId: result.deviceId,
      token: result.token,
      pairedAt: new Date().toISOString()
    };
    const next = [...paired.filter((item) => item.serverId !== record.serverId), record];
    writeJsonAtomic(path.join(this.userDataPath, 'network', 'paired-servers.json'), next);
    return { serverId: record.serverId, name: record.name, address, port, pairedAt: record.pairedAt };
  }

  async handleRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    if (url.pathname === '/v1/library' || url.pathname.startsWith('/v1/library/') || /^\/v1\/tracks\/\d+\/stream$/.test(url.pathname)) {
      const device = this.authorize(req);
      if (!device) return this.sendJson(res, 401, { error: 'Device authorization required.' });
      const handled = await this.libraryStreaming.handleRequest(req, res, url);
      if (handled !== false) return handled;
    }
    if (req.method === 'GET' && url.pathname === '/v1/info') {
      return this.sendJson(res, 200, {
        protocol: PROTOCOL, serverId: this.serverId, name: this.deviceName,
        version: 1, pairingRequired: true
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/pair') {
      const ip = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const attempts = (this.pairAttempts.get(ip) || []).filter((time) => now - time < 60000);
      if (attempts.length >= MAX_PAIR_ATTEMPTS_PER_IP) {
        this.pairAttempts.set(ip, attempts);
        return this.sendJson(res, 429, { error: 'Too many pairing attempts. Wait a minute and try again.' });
      }
      attempts.push(now);
      this.pairAttempts.set(ip, attempts);
      let body;
      try { body = await this.readBody(req); }
      catch (error) { return this.sendJson(res, 400, { error: error.message }); }
      const suppliedCode = String(body.code || '');
      if (!this.pairCode || now > this.pairCodeExpiresAt || !safeEqualText(suppliedCode, this.pairCode)) {
        return this.sendJson(res, 401, { error: 'The pairing code is invalid or expired.' });
      }
      const deviceId = typeof body.deviceId === 'string' && /^[a-f0-9-]{36}$/i.test(body.deviceId)
        ? body.deviceId : crypto.randomUUID();
      const deviceName = String(body.deviceName || 'Sleeve device').trim().slice(0, 80) || 'Sleeve device';
      const token = crypto.randomBytes(32).toString('base64url');
      this.devices = this.devices.filter((device) => device.id !== deviceId);
      this.devices.push({
        id: deviceId, name: deviceName, tokenHash: hashToken(token),
        pairedAt: new Date().toISOString(), lastSeenAt: null, revokedAt: null
      });
      writeJsonAtomic(this.devicesPath, this.devices);
      this.rotatePairingCode();
      return this.sendJson(res, 200, {
        serverId: this.serverId, serverName: this.deviceName, deviceId, token
      });
    }
    if (req.method === 'GET' && url.pathname === '/v1/devices') {
      const device = this.authorize(req);
      if (!device) return this.sendJson(res, 401, { error: 'Device authorization required.' });
      return this.sendJson(res, 200, {
        devices: this.devices.filter((item) => !item.revokedAt).map(({ id, name, pairedAt, lastSeenAt }) => ({ id, name, pairedAt, lastSeenAt }))
      });
    }
    return this.sendJson(res, 404, { error: 'Not found.' });
  }

  authorize(req) {
    const match = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]+)$/);
    if (!match) return null;
    const digest = hashToken(match[1]);
    const device = this.devices.find((item) => !item.revokedAt && safeEqualText(item.tokenHash, digest));
    if (device) {
      device.lastSeenAt = new Date().toISOString();
      writeJsonAtomic(this.devicesPath, this.devices);
    }
    return device || null;
  }

  revokeDevice(deviceId) {
    const device = this.devices.find((item) => item.id === deviceId && !item.revokedAt);
    if (!device) return false;
    device.revokedAt = new Date().toISOString();
    device.tokenHash = '';
    writeJsonAtomic(this.devicesPath, this.devices);
    return true;
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk.toString('utf8');
        if (Buffer.byteLength(data) > MAX_BODY_BYTES) {
          reject(new Error('Request body is too large.'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch (_) { reject(new Error('Invalid JSON body.')); }
      });
      req.on('error', reject);
    });
  }

  sendJson(res, status, value) {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
}

module.exports = { LocalNetworkService, DISCOVERY_PORT, SERVER_PORT, PROTOCOL };
