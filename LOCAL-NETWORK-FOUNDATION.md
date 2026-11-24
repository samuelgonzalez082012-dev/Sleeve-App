# Local network foundation (Phase 8.1–8.3)

This branch introduces the Electron main-process foundation for local Sleeve hosting, server discovery, and explicit device pairing.

## Current implementation

- The host starts an HTTP server on TCP port 45832, bound to the local network interfaces.
- A UDP discovery listener/broadcaster uses port 45831. Discovery packets contain only the protocol version, server ID, display name, and TCP port; they never contain pairing codes or device credentials.
- Pairing uses a six-digit, cryptographically generated code that expires after ten minutes and is rotated after a successful pairing.
- Pair attempts are rate-limited per source IP.
- Each paired device receives a random bearer token once. The host stores only its SHA-256 hash, and revocation invalidates that token.
- The host's device registry is stored under Electron's userData directory in `network/paired-devices.json`.
- A client pairing operation stores its returned host token under `network/paired-servers.json` for later authenticated requests.
- Narrow IPC methods are exposed through preload; renderer code does not receive filesystem or raw socket access.

## IPC surface

- `localNetworkGetHostStatus()`
- `localNetworkStartHost()`
- `localNetworkStopHost()`
- `localNetworkDiscover(timeoutMs)`
- `localNetworkPair({ address, port, code, deviceName })`
- `localNetworkRevokeDevice(deviceId)`

## HTTP endpoints currently available

- `GET /v1/info` — non-sensitive server identity and protocol information.
- `POST /v1/pair` — exchange the current one-time pairing code for a device token.
- `GET /v1/devices` — authenticated list of paired devices.

Library browsing, audio streaming, and remote playback endpoints are intentionally not included yet; those belong to later Phase 8 tasks.

## Security note

This is the first LAN foundation, not the final security pass. The current transport is plain HTTP on the local network. Pairing codes are short-lived and rate-limited, and long-lived device tokens are hashed on the host, but HTTP does not protect credentials from a hostile device able to observe LAN traffic. Do not use this on an untrusted/public network. Before calling Phase 8 complete, add authenticated TLS with certificate pinning, stronger abuse controls, and a visible device-management interface as part of the security work.

## Validation

A focused test is provided at `tests/test-local-network-service.js`. Run it with:

```bash
node tests/test-local-network-service.js
```

The full Electron app and real multi-device discovery still need to be tested on the target operating systems and networks.


## Phase 8.4–8.6 — paired library browsing and audio delivery

The host renderer sends a debounced metadata snapshot to the main process. The main process resolves each local source path, rejects missing files, symbolic links, video files, and unsupported extensions, then keeps an allowlisted index in memory. The network API never returns source paths or exposes a directory listing.

Authenticated endpoints (all require the paired device's bearer token):

- `GET /v1/library` — available sections and item counts.
- `GET /v1/library/tracks?limit=100&offset=0&q=search` — paginated track metadata.
- `GET /v1/library/albums` — albums grouped by artist and album title.
- `GET /v1/library/artists` — artists and track/album counts.
- `GET /v1/library/genres` — distinct genres.
- `GET /v1/library/playlists` — music playlists.
- `GET /v1/library/playlists/:id/tracks` — tracks in a music playlist.
- `GET /v1/tracks/:id/stream` — original file bytes with HTTP byte-range support (206 responses), allowing clients to seek.
- `GET /v1/tracks/:id/stream?quality=compact&start=SECONDS` — transcode to 96-kbps MP3 using FFmpeg. The `start` parameter provides time-based seeking for compact mode; compact mode does not support byte ranges.

Quality choices:
- **Original** preserves the stored file format and bitrate. Range requests are supported.
- **Compact** transcodes on demand to 96-kbps MP3. FFmpeg must be available on the host; otherwise the endpoint returns HTTP 503.

The server-side endpoints and library snapshot plumbing are implemented in this chunk. A dedicated remote-library browsing/player screen and a client-side player that attaches the bearer token to stream requests are still follow-up UI work; this is not yet a complete end-to-end playback experience.

The LAN transport is still plain HTTP. Do not use this on an untrusted/public network. The TLS, certificate-pinning, and final security work remains required under Phase 8.8.
