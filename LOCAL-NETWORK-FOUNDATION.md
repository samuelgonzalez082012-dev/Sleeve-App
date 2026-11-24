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
