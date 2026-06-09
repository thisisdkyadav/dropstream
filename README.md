# P2P File Transfer

A Cloudflare Worker prototype for peer-to-peer file transfer in the browser.

The Worker handles only WebRTC signaling. File bytes move through a WebRTC
DataChannel directly between the two browsers when the network allows it.

## Architecture

```text
Browser A <-> Cloudflare Worker Durable Object <-> Browser B
Browser A <============ WebRTC DataChannel ============> Browser B
```

Durable Objects are used instead of Redis for the first Cloudflare version
because a room needs live WebSocket coordination. Redis is useful for TTL room
metadata or audit records, but it is not a natural replacement for a room actor
that owns two WebSocket connections.

## Local Development

Install dependencies in an environment with Node.js:

```bash
npm install
npm run dev
```

Then open the local Wrangler URL in two browser tabs or devices:

1. Use the same room code on both devices.
2. Choose `Send` on one device and `Receive` on the other.
3. Connect both.
4. Pick a file on the sender and start the transfer.

## Deploy

```bash
npm run deploy
```

## Large File Notes

- Files are sent in chunks over a WebRTC DataChannel.
- The sender uses backpressure to avoid flooding browser memory.
- The receiver uses the File System Access API when available, which lets
  Chromium-based browsers stream large files directly to disk.
- Browsers without `showSaveFilePicker` fall back to buffering the received file
  in memory before saving, which is not suitable for multi-GB files.
- WebRTC may fail on strict networks unless a TURN server is configured.

## Next Steps

- Add a TURN provider for reliable transfers across strict NATs.
- Add file hashing and post-transfer integrity checks.
- Add resumable chunk tracking.
- Add optional Redis storage for short-lived room metadata if product needs it.
