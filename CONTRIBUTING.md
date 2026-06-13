# Contributing to DropStream

Thanks for your interest in improving DropStream! This is a small, dependency-light
project and contributions of all sizes are welcome.

## Ground rules

- **Discuss first for big changes.** Open an issue before starting substantial work so
  we can agree on the approach.
- **Keep it buildless.** The front-end is intentionally vanilla HTML / CSS / ES modules
  with no bundler or framework. Please don't introduce a build step or a heavy dependency
  without discussion.
- **No secrets in commits.** Never commit `.dev.vars`, API keys, or TURN credentials.
  They're git-ignored for a reason.

## Development setup

```bash
npm install
npm run dev
```

Open the local URL in two browser tabs to exercise a transfer. For anything touching the
connection logic, **test a real transfer between two devices** (ideally on different
networks) — much of the behavior only shows up with real WebRTC/NAT conditions.

### Project layout

```
public/
  index.html        UI markup
  styles.css        styles (light-blue glass theme)
  app.js            all client logic (signaling, WebRTC, transfer, UI)
  sha256.js         dependency-free streaming SHA-256 (integrity checks)
  sw.js             service worker (PWA shell, network-first)
  manifest.webmanifest, icon.svg
src/
  worker.js         Cloudflare Worker + `Room` Durable Object (signaling + /api/turn)
wrangler.toml       Worker/DO/assets config
```

## Pull requests

- Keep PRs focused; one logical change per PR.
- Match the existing code style (naming, formatting, comment density).
- Update the README if you change behavior, configuration, or limitations.
- Describe how you tested it (browsers/devices/networks).

## Reporting bugs

Open an issue with steps to reproduce, the browsers/OS involved, and whether the two
devices were on the same network or different ones (this matters a lot for WebRTC).
For security issues, see [SECURITY.md](SECURITY.md) instead.
