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

    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "receiver" ? "receiver" : "sender";

    if (this.peers.has(role)) {
      return new Response("Role already connected", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    this.peers.set(role, server);

    this.send(server, {
      type: "ready",
      role,
      peerConnected: this.peers.size === 2
    });

    this.broadcast({
      type: "presence",
      peers: [...this.peers.keys()]
    });

    server.addEventListener("message", (event) => {
      this.forward(role, event.data);
    });

    const close = () => {
      if (this.peers.get(role) === server) {
        this.peers.delete(role);
      }

      this.broadcast({
        type: "presence",
        peers: [...this.peers.keys()]
      });
    };

    server.addEventListener("close", close);
    server.addEventListener("error", close);

    return new Response(null, { status: 101, webSocket: client });
  }

  forward(fromRole, raw) {
    const toRole = fromRole === "sender" ? "receiver" : "sender";
    const peer = this.peers.get(toRole);

    if (!peer) {
      return;
    }

    try {
      const message = JSON.parse(raw);
      this.send(peer, { ...message, from: fromRole });
    } catch {
      this.send(peer, { type: "error", message: "Invalid signaling payload" });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/room/")) {
      const roomId = url.pathname.split("/").filter(Boolean).at(-1);

      if (!roomId || !/^[a-z0-9-]{4,64}$/i.test(roomId)) {
        return new Response("Invalid room id", { status: 400 });
      }

      const id = env.ROOMS.idFromName(roomId.toLowerCase());
      const room = env.ROOMS.get(id);
      return room.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
