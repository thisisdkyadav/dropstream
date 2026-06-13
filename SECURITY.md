# Security Policy

## Reporting a vulnerability

If you discover a security issue, please **do not open a public issue**. Instead, report it
privately to the maintainer (e.g. via a GitHub private security advisory on the repository,
or by email). Include steps to reproduce and the potential impact. You'll get an
acknowledgement as soon as possible.

## Scope & threat model

DropStream is a peer-to-peer transfer tool. A few things worth knowing:

- **File contents** travel over an encrypted WebRTC `DataChannel` (DTLS) directly between
  peers. The signaling server (Cloudflare Worker + Durable Object) never receives file
  bytes.
- The **signaling server** sees the room code and the WebRTC SDP/ICE metadata required to
  connect two peers.
- **Room codes are capabilities.** Anyone who knows a room code can attempt to join it.
  Use the optional **passphrase** to gate a room; it is verified via a SHA-256 handshake
  over the data channel and is never sent to the server or embedded in a share link.
- **TURN credentials** are short-lived and minted server-side. The Metered API key must be
  stored as a Wrangler secret (or in a git-ignored `.dev.vars` locally) and is never shipped
  to the browser.
- The bundled **public Open Relay** fallback is a shared, best-effort third-party service.
  Traffic relayed through it passes through that third party. Configure your own TURN for
  anything sensitive.

## Out of scope

- Denial of service against your own deployment via room flooding (rate-limit at the edge
  if needed).
- The security of third-party TURN/STUN providers you choose to configure.
