# DropStream

**Send files and text straight from one browser to another — no cloud storage, no signup, no size limits.**

DropStream is a peer-to-peer file transfer app. File bytes travel directly between the two browsers over an encrypted WebRTC data channel; a Cloudflare Worker (backed by a Durable Object) is used **only** to introduce the two peers (signaling) and to mint short-lived TURN credentials. Once connected, your files never touch a server.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)
![WebRTC](https://img.shields.io/badge/WebRTC-DataChannel-green)

---

## Features

- **Direct peer-to-peer** — bytes move browser-to-browser over a WebRTC `DataChannel`, encrypted in transit by DTLS. The server only relays signaling.
- **Bidirectional** — no Send/Receive roles. Either device can send files or text once connected.
- **Multiple files & folders** — pick several files, drag-and-drop, or choose a whole folder; they stream back-to-back with overall progress.
- **Streams to disk** — uses the File System Access API to write large files straight to disk on supported browsers (no full-file buffering); falls back to an in-memory download elsewhere.
- **Text / link sharing** — fire a quick message or URL across, shown in a copyable card with an "open link" action.
- **Integrity checks** — every file is hashed with a streaming SHA-256 on both ends and verified on arrival (✓ / mismatch warning).
- **Optional passphrase lock** — protect a room with a passphrase; both sides prove knowledge of it via a hash handshake. The passphrase never reaches the server or the share link.
- **QR & deep links** — share a room with a scannable QR code or a `/<room-code>` link that auto-joins.
- **Reconnect recovery** — dropped signaling sockets and failed peers auto-recover with backoff and a coordinated re-handshake.
- **Resilient connectivity** — STUN for direct hole-punching, with an optional TURN relay for strict/symmetric NATs (e.g. mobile data).
- **Installable PWA** — add to home screen, offline app shell, network-first updates.
- **Wake lock** — keeps the screen awake during a transfer so mobile devices don't sleep and drop the connection.

## How it works

```text
                 ┌─────────────────────────────────────┐
                 │  Cloudflare Worker + Durable Object  │
                 │  • WebRTC signaling (WebSocket)      │
                 │  • /api/turn → TURN credentials      │
                 └──────────────┬──────────────────────┘
        signaling (offer/       │       signaling
        answer/ICE) over WS     │       over WS
                 ┌──────────────┴───────────┐
                 ▼                          ▼
            ┌─────────┐   encrypted    ┌─────────┐
            │ Browser │◀══ WebRTC ═════▶│ Browser │
            │    A    │   DataChannel   │    B    │
            └─────────┘  (file bytes)   └─────────┘
```

- A **Durable Object** (`Room`) owns the two WebSocket connections for a room code and relays the WebRTC offer/answer/ICE candidates between them. It assigns connection-level slots (`a`/`b`); the first peer is the WebRTC initiator. It never sees file bytes.
- The **Worker** serves the static front-end and a `/api/turn` endpoint that returns ICE servers. File data flows **only** over the direct (or TURN-relayed) `DataChannel`.

## Tech stack

- **Cloudflare Workers** + **Durable Objects** (signaling, static assets)
- **WebRTC** `RTCPeerConnection` / `RTCDataChannel`
- Vanilla **HTML / CSS / ES modules** — no front-end framework, no build step
- **Wrangler** for local dev and deploy

## Getting started

### Prerequisites

- Node.js 18+
- A Cloudflare account (free tier is fine) for deploying

### Run locally

```bash
npm install
npm run dev
```

Open the printed local URL in two tabs (or two devices on the same machine/network):

1. Use the **same room code** on both (or share the QR / link from one to the other).
2. Click **Connect** on both.
3. Drop a file (or type text) on either side and send. The other side accepts and saves.

> To test across **different networks** (e.g. laptop ↔ phone on cellular), you'll likely need a TURN server — see [Configuration](#configuration).

## Configuration

DropStream works out of the box with public STUN + the Metered Open Relay fallback. For reliable transfers across strict/symmetric NATs (common on mobile carriers), configure your own **TURN** project:

1. Create a free TURN app at [dashboard.metered.ca](https://dashboard.metered.ca).
2. Set your subdomain in `wrangler.toml`:
   ```toml
   [vars]
   METERED_APP = "your-app"   # from "your-app.metered.live"
   ```
3. Add the API key as a secret (never commit it):
   ```bash
   npx wrangler secret put METERED_API_KEY
   ```
   For local dev, copy `.dev.vars.example` to `.dev.vars` and put the key there.

The Worker (`src/worker.js`) mints short-lived credentials on each `/api/turn` request, so the key stays server-side and is never exposed to the browser. If `METERED_APP` / `METERED_API_KEY` are unset, it falls back to public STUN + Open Relay.

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `METERED_APP` | `wrangler.toml` `[vars]` | No | Your Metered app subdomain |
| `METERED_API_KEY` | Wrangler secret / `.dev.vars` | No | Metered API key (kept server-side) |

## Deploy

```bash
npx wrangler secret put METERED_API_KEY   # optional, for TURN
npm run deploy
```

This deploys the Worker, the Durable Object migration, and the static assets. Wrangler prints your `*.workers.dev` URL (or attach a custom domain in the Cloudflare dashboard).

## Browser support

- **Chromium-based (Chrome, Edge, Brave)** — full support, including streaming large files to disk and folder selection via the File System Access API.
- **Firefox / Safari** — transfers work; without the File System Access API, received files are buffered in memory and downloaded, which isn't ideal for multi-GB files. Folder picking and directory streaming are limited.

## Security & privacy

- File bytes are sent over a WebRTC `DataChannel`, which is **encrypted (DTLS)** end to end. The signaling server never receives file contents.
- The signaling server *does* see the room code and the WebRTC SDP/ICE metadata needed to connect peers.
- A room is reachable by anyone who knows its code. Use the **optional passphrase** to gate a room — it's verified via a SHA-256 handshake over the data channel and never sent to the server or embedded in the share link.
- TURN credentials are short-lived and minted server-side; the Metered API key is a Wrangler secret and is not shipped to the client.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Limitations

- **Two peers per room.** Group/broadcast transfer is not implemented.
- **One transfer at a time.** While a transfer is active, the other direction is blocked (shared progress state).
- **No resume.** If a transfer is interrupted, it must be restarted (the connection itself auto-recovers).
- The **public Open Relay fallback** is a shared best-effort service with no guarantees — configure your own TURN for anything you rely on.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). In short: open an issue to discuss substantial changes, keep the no-build vanilla style, and run `npm run dev` to test a real two-device transfer before opening a PR.

## License

[MIT](LICENSE) © Devesh Yadav
