export class Room {
  constructor(state) {
    this.state = state;
    this.peers = new Map();
  }

  async fetch(request) {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    // Roles are connection-level only: the first peer ("a") is the WebRTC
    // initiator (creates the offer), the second ("b") answers. Both peers can
    // send and receive over the data channel, so there is no user-facing role.
    let slot;
    if (!this.peers.has("a")) {
      slot = "a";
    } else if (!this.peers.has("b")) {
      slot = "b";
    } else {
      return new Response("Room is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    this.peers.set(slot, server);

    this.send(server, {
      type: "ready",
      slot,
      initiator: slot === "a",
      peerConnected: this.peers.size === 2
    });

    this.broadcast({
      type: "presence",
      count: this.peers.size
    });

    server.addEventListener("message", (event) => {
      this.forward(slot, event.data);
    });

    const close = () => {
      if (this.peers.get(slot) === server) {
        this.peers.delete(slot);
      }

      this.broadcast({
        type: "presence",
        count: this.peers.size
      });
    };

    server.addEventListener("close", close);
    server.addEventListener("error", close);

    return new Response(null, { status: 101, webSocket: client });
  }

  forward(fromSlot, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    // Relay to the other peer (only two slots exist).
    for (const [slot, peer] of this.peers) {
      if (slot !== fromSlot) {
        this.send(peer, { ...message, from: fromSlot });
      }
    }
  }

  broadcast(message) {
    for (const peer of this.peers.values()) {
      this.send(peer, message);
    }
  }

  send(peer, message) {
    try {
      peer.send(JSON.stringify(message));
    } catch {
      // The close handler will clear the peer.
    }
  }
}

// Preferred path: fetch ready-to-use iceServers from a private Metered project
// using its API key (kept server-side). Falls back to the public Open Relay HMAC
// path if the key is missing or the request fails.
async function turnIceServers(env) {
  if (env.METERED_API_KEY && env.METERED_APP) {
    try {
      const url = `https://${env.METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_API_KEY)}`;
      const response = await fetch(url);
      if (response.ok) {
        const servers = await response.json();
        if (Array.isArray(servers) && servers.length > 0) {
          // Prepend a public STUN server for extra redundancy.
          return [{ urls: "stun:stun.l.google.com:19302" }, ...servers];
        }
      }
    } catch {
      // Fall through to the public Open Relay fallback.
    }
  }

  return openRelayIceServers(env);
}

// TURN REST credentials (coturn "use-auth-secret" scheme): the username is an
// expiry timestamp and the credential is base64(HMAC-SHA1(secret, username)).
// Defaults target Metered's free Open Relay; override TURN_SECRET / TURN_HOST
// in wrangler vars to point at a private TURN server later.
async function openRelayIceServers(env) {
  const secret = env.TURN_SECRET || "openrelayprojectsecret";
  const host = env.TURN_HOST || "staticauth.openrelay.metered.ca";
  const ttlSeconds = 12 * 60 * 60;

  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = String(expiry);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username));
  const credential = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: `stun:${host}:80` },
    {
      urls: [
        `turn:${host}:80`,
        `turn:${host}:443`,
        `turn:${host}:443?transport=tcp`,
        `turns:${host}:443?transport=tcp`
      ],
      username,
      credential
    }
  ];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/turn") {
      const iceServers = await turnIceServers(env);
      return Response.json({ iceServers }, {
        headers: { "Cache-Control": "no-store" }
      });
    }

    if (url.pathname.startsWith("/api/room/")) {
      const roomId = url.pathname.split("/").filter(Boolean).at(-1);

      if (!roomId || !/^[a-z0-9-]{4,64}$/i.test(roomId)) {
        return new Response("Invalid room id", { status: 400 });
      }

      const id = env.ROOMS.idFromName(roomId.toLowerCase());
      const room = env.ROOMS.get(id);
      return room.fetch(request);
    }

    // Room deep links (e.g. from QR codes): /<code> serves the app shell;
    // the client reads the code from the path and joins automatically.
    if (/^\/[a-z0-9-]{4,64}$/.test(url.pathname)) {
      return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    }

    return env.ASSETS.fetch(request);
  }
};
