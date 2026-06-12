const roomInput = document.querySelector("#roomInput");
const newRoomButton = document.querySelector("#newRoomButton");
const connectButton = document.querySelector("#connectButton");
const disconnectButton = document.querySelector("#disconnectButton");
const senderRole = document.querySelector("#senderRole");
const receiverRole = document.querySelector("#receiverRole");
const fileInput = document.querySelector("#fileInput");
const sendButton = document.querySelector("#sendButton");
const fileName = document.querySelector("#fileName");
const fileSize = document.querySelector("#fileSize");
const connectionState = document.querySelector("#connectionState");
const transferPanel = document.querySelector("#transferPanel");
const noticeText = document.querySelector("#noticeText");
const incomingModal = document.querySelector("#incomingModal");
const incomingDetails = document.querySelector("#incomingDetails");
const modalSaveButton = document.querySelector("#modalSaveButton");
const cancelIncomingButton = document.querySelector("#cancelIncomingButton");
const progressArea = document.querySelector("#progressArea");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");
const speedText = document.querySelector("#speedText");
const receivedText = document.querySelector("#receivedText");
const senderActions = document.querySelectorAll(".sender-action");
const diagLog = document.querySelector("#diagLog");
const diagVerdict = document.querySelector("#diagVerdict");
const diagIpv6 = document.querySelector("#diagIpv6");
const diagPath = document.querySelector("#diagPath");
const diagIce = document.querySelector("#diagIce");
const copyDiagButton = document.querySelector("#copyDiagButton");
const clearDiagButton = document.querySelector("#clearDiagButton");

const chunkSize = 64 * 1024;
const maxBufferedAmount = 1 * 1024 * 1024;

let role = "sender";
let socket;
let peer;
let channel;
let selectedFile;
let receiveMeta;
let receivedBuffers = [];
let receivedBytes = 0;
let fileWriter;
let writeChain = Promise.resolve();
let startedAt = 0;
let receiverReadyResolve;
let receiverReadyReject;
let isConnected = false;
let sawIpv6Local = false;
let candidateCounts = { host: 0, srflx: 0, prflx: 0, relay: 0 };
let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

roomInput.value = createRoomId();

newRoomButton.addEventListener("click", () => {
  roomInput.value = createRoomId();
});

senderRole.addEventListener("click", () => setRole("sender"));
receiverRole.addEventListener("click", () => setRole("receiver"));
connectButton.addEventListener("click", () => {
  connect().catch((error) => {
    showNotice(error.message || "Connect failed.");
    connectButton.disabled = false;
    renderUi();
  });
});
disconnectButton.addEventListener("click", disconnect);
sendButton.addEventListener("click", () => {
  sendFile().catch((error) => {
    showNotice(error.message || "Send failed.");
    updateSendState();
  });
});
modalSaveButton.addEventListener("click", () => {
  prepareIncomingSave().catch((error) => {
    showNotice(error.message || "Save setup failed.");
    channel?.send(JSON.stringify({ type: "receiver-cancelled" }));
    modalSaveButton.disabled = false;
    hideIncomingModal();
  });
});
cancelIncomingButton.addEventListener("click", cancelIncomingFile);

fileInput.addEventListener("change", () => {
  selectedFile = fileInput.files?.[0];
  fileName.textContent = selectedFile ? selectedFile.name : "No file selected";
  fileSize.textContent = selectedFile ? formatBytes(selectedFile.size) : "";
  if (selectedFile) {
    showNotice("Ready to send when the receiver is connected.");
  }
  updateSendState();
});

renderUi();

function setRole(nextRole) {
  role = nextRole;
  senderRole.classList.toggle("active", role === "sender");
  receiverRole.classList.toggle("active", role === "receiver");
  fileInput.disabled = role !== "sender";
  showNotice(role === "sender" ? "Connect, then choose a file." : "Connect and wait for an incoming file.");
  updateSendState();
  updateReceiverControls();
  renderUi();
}

async function connect() {
  disconnect();
  resetTransfer();

  const roomId = roomInput.value.trim().toLowerCase();
  if (!/^[a-z0-9-]{4,64}$/.test(roomId)) {
    showNotice("Room code must be 4-64 letters, numbers, or dashes.");
    return;
  }

  connectButton.disabled = true;
  renderUi();
  resetDiagnostics();
  await loadIceServers();

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/api/room/${roomId}?role=${role}`);
  socket.addEventListener("open", () => {
    isConnected = true;
    setStatus("Connecting");
    showNotice(role === "sender" ? "Waiting for receiver." : "Waiting for incoming file.");
    renderUi();
    createPeer();
  });
  socket.addEventListener("message", handleSignal);
  socket.addEventListener("close", () => {
    isConnected = false;
    hideIncomingModal();
    setStatus("Not connected");
    showNotice("Connect to start a room.");
    connectButton.disabled = false;
    renderUi();
  });
  socket.addEventListener("error", () => showNotice("Connection error."));

  connectButton.disabled = true;
  renderUi();
}

async function loadIceServers() {
  try {
    const response = await fetch("/api/turn");
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const data = await response.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      iceServers = data.iceServers;
      const hasTurn = iceServers.some((server) =>
        [].concat(server.urls).some((url) => String(url).startsWith("turn"))
      );
      logDiag(`Loaded ${iceServers.length} ICE servers${hasTurn ? " (TURN relay enabled)" : " (STUN only)"}.`);
      return;
    }
    throw new Error("empty config");
  } catch (error) {
    iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    logDiag(`TURN config unavailable (${error.message}); falling back to STUN only.`);
  }
}

function createPeer() {
  peer = new RTCPeerConnection({ iceServers });

  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      logLocalCandidate(event.candidate);
      signal({ type: "candidate", candidate: event.candidate });
    } else {
      logDiag(`Gathering complete: ${summarizeCandidates(candidateCounts)}`);
      if (!sawIpv6Local) {
        logDiag("No IPv6 candidate gathered on this device — IPv6 path unavailable here.");
      }
      const turnConfigured = iceServers.some((server) =>
        [].concat(server.urls).some((url) => String(url).startsWith("turn"))
      );
      if (turnConfigured && candidateCounts.relay === 0) {
        logDiag("⚠ TURN was configured but produced NO relay candidate — allocation failed (see ICE server error above: 401=bad creds, 701=unreachable).");
        setVerdict("TURN allocation failed", "is-bad");
      }
    }
  });

  peer.addEventListener("icecandidateerror", (event) => {
    // 401 = TURN credentials rejected, 403 = forbidden, 701 = server unreachable.
    logDiag(
      `ICE server error · code=${event.errorCode} · "${event.errorText || ""}" · ${event.url || ""}`
    );
  });

  peer.addEventListener("icegatheringstatechange", () => {
    logDiag(`ICE gathering: ${peer.iceGatheringState}`);
  });

  peer.addEventListener("iceconnectionstatechange", () => {
    diagIce.textContent = peer.iceConnectionState;
    logDiag(`ICE connection: ${peer.iceConnectionState}`);
    if (peer.iceConnectionState === "failed") {
      logDiag("ICE FAILED — no working candidate pair. Likely symmetric NAT on one/both sides and no relay (TURN).");
      setVerdict("No direct path found", "is-bad");
    }
  });

  peer.addEventListener("connectionstatechange", () => {
    setStatus(peer.connectionState);
    logDiag(`Peer connection: ${peer.connectionState}`);
    if (peer.connectionState === "connected") {
      showNotice(role === "sender" ? "Select a file to send." : "Ready to receive.");
      reportSelectedPair();
    }
    if (peer.connectionState === "failed") {
      setVerdict("Connection failed", "is-bad");
    }
    updateSendState();
    renderUi();
  });

  peer.addEventListener("datachannel", (event) => {
    setupChannel(event.channel);
  });

  if (role === "sender") {
    setupChannel(peer.createDataChannel("file", { ordered: true }));
  }
}

async function handleSignal(event) {
  const message = JSON.parse(event.data);

  if (message.type === "presence") {
    if (message.peers.length < 2) {
      showNotice(role === "sender" ? "Waiting for receiver." : "Waiting for sender.");
    }

    if (role === "sender" && message.peers.includes("receiver") && peer && !peer.localDescription) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signal({ type: "offer", description: peer.localDescription });
    }
    return;
  }

  if (!peer) {
    return;
  }

  if (message.type === "offer") {
    await peer.setRemoteDescription(message.description);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    signal({ type: "answer", description: peer.localDescription });
    return;
  }

  if (message.type === "answer") {
    await peer.setRemoteDescription(message.description);
    return;
  }

  if (message.type === "candidate") {
    const remote = message.candidate;
    if (remote) {
      const info = describeCandidate(remote);
      logDiag(
        `remote candidate · ${info.type} · ${info.family} · ${info.protocol} · ${info.address}:${info.port}`
      );
    }
    try {
      await peer.addIceCandidate(remote);
    } catch (error) {
      logDiag(`addIceCandidate failed: ${error.message}`);
    }
  }
}

function setupChannel(nextChannel) {
  channel = nextChannel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = maxBufferedAmount / 2;

  channel.addEventListener("open", () => {
    setStatus("Ready");
    showNotice(role === "sender" ? "Select a file to send." : "Ready to receive.");
    updateSendState();
    updateReceiverControls();
    renderUi();
  });

  channel.addEventListener("close", () => {
    showNotice("Peer connection closed.");
    updateSendState();
    updateReceiverControls();
    renderUi();
  });

  channel.addEventListener("message", (event) => {
    receiveChunk(event).catch((error) => {
      showNotice(error.message || "Receive failed.");
    });
  });
}

async function sendFile() {
  if (!selectedFile || !channel || channel.readyState !== "open") {
    return;
  }

  resetTransfer();
  startedAt = performance.now();
  showNotice(`Sending ${selectedFile.name}.`);
  sendControl({
    type: "meta",
    name: selectedFile.name,
    size: selectedFile.size,
    mime: selectedFile.type || "application/octet-stream"
  });
  await waitForReceiverReady();

  for (let offset = 0; offset < selectedFile.size; offset += chunkSize) {
    const chunk = await selectedFile.slice(offset, offset + chunkSize).arrayBuffer();
    await sendBinary(chunk);
    updateProgress(Math.min(offset + chunk.byteLength, selectedFile.size), selectedFile.size);
  }

  await waitForBuffer(0);
  sendControl({ type: "done" });
  showNotice("Send complete.");
}

async function receiveChunk(event) {
  if (typeof event.data === "string") {
    const message = JSON.parse(event.data);

    if (message.type === "meta") {
      receiveMeta = message;
      receivedBuffers = [];
      receivedBytes = 0;
      fileWriter = undefined;
      writeChain = Promise.resolve();
      startedAt = performance.now();
      updateProgress(0, message.size);
      updateReceiverControls();
      showIncomingModal();
      showNotice("Incoming file is ready to save.");
    }

    if (message.type === "ready-to-receive") {
      receiverReadyResolve?.();
      receiverReadyResolve = undefined;
      receiverReadyReject = undefined;
    }

    if (message.type === "receiver-cancelled") {
      receiverReadyReject?.(new Error("Receiver cancelled the save."));
      receiverReadyResolve = undefined;
      receiverReadyReject = undefined;
      return;
    }

    if (message.type === "done") {
      if (fileWriter) {
        await writeChain;
        await fileWriter.close();
        fileWriter = undefined;
      } else {
        const blob = new Blob(receivedBuffers, {
          type: receiveMeta?.mime || "application/octet-stream"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = receiveMeta?.name || "download";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      hideIncomingModal();
      showNotice("Download complete.");
      receiveMeta = undefined;
      receivedBuffers = [];
      updateReceiverControls();
    }

    return;
  }

  if (fileWriter) {
    writeChain = writeChain.then(() => fileWriter.write(event.data));
    await writeChain;
  } else {
    receivedBuffers.push(event.data);
  }

  receivedBytes += event.data.byteLength;
  updateProgress(receivedBytes, receiveMeta?.size || receivedBytes);
}

function waitForReceiverReady() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      receiverReadyResolve = undefined;
      receiverReadyReject = undefined;
      reject(new Error("Receiver did not become ready in time."));
    }, 120000);

    receiverReadyResolve = () => {
      clearTimeout(timer);
      resolve();
    };
    receiverReadyReject = (error) => {
      clearTimeout(timer);
      reject(error);
    };
  });
}

async function prepareIncomingSave() {
  if (!receiveMeta || !channel || channel.readyState !== "open") {
    return;
  }

  modalSaveButton.disabled = true;

  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: receiveMeta.name
    });
    fileWriter = await handle.createWritable();
  } else {
    showNotice("This browser will save after the full file is received.");
  }

  channel.send(JSON.stringify({ type: "ready-to-receive" }));
  hideIncomingModal();
  showNotice("Receiving file.");
}

function sendControl(message) {
  channel.send(JSON.stringify(message));
}

async function sendBinary(chunk) {
  while (channel?.readyState === "open") {
    await waitForBuffer(maxBufferedAmount);

    try {
      channel.send(chunk);
      return;
    } catch (error) {
      if (!String(error.message).includes("send queue is full")) {
        throw error;
      }

      await waitForBuffer(maxBufferedAmount / 2);
    }
  }

  throw new Error("Data channel closed during transfer.");
}

function waitForBuffer(limit = maxBufferedAmount) {
  if (!channel || channel.readyState !== "open") {
    return Promise.reject(new Error("Data channel is not open."));
  }

  if (channel.bufferedAmount <= limit) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (!channel || channel.readyState !== "open" || channel.bufferedAmount <= limit) {
        cleanup();
        resolve();
      }
    }, 50);

    const cleanup = () => {
      clearInterval(poll);
      channel?.removeEventListener("bufferedamountlow", onLow);
    };

    const onLow = () => {
      cleanup();
      resolve();
    };

    channel.addEventListener("bufferedamountlow", onLow);
  });
}

function signal(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function disconnect() {
  channel?.close();
  peer?.close();
  socket?.close();
  channel = undefined;
  peer = undefined;
  socket = undefined;
  isConnected = false;
  setStatus("Not connected");
  hideIncomingModal();
  showNotice("Connect to start a room.");
  updateSendState();
  updateReceiverControls();
  renderUi();
}

function resetTransfer() {
  receivedBuffers = [];
  receivedBytes = 0;
  receiveMeta = undefined;
  fileWriter = undefined;
  writeChain = Promise.resolve();
  receiverReadyResolve = undefined;
  receiverReadyReject = undefined;
  startedAt = 0;
  updateProgress(0, 0);
  updateReceiverControls();
  hideIncomingModal();
}

function updateSendState() {
  sendButton.disabled = role !== "sender" || !selectedFile || channel?.readyState !== "open";
}

function updateReceiverControls() {
  modalSaveButton.disabled =
    role !== "receiver" || !receiveMeta || !!fileWriter || channel?.readyState !== "open";
}

function renderUi() {
  transferPanel.classList.toggle("hidden", !isConnected);
  disconnectButton.classList.toggle("hidden", !isConnected);
  connectButton.classList.toggle("hidden", isConnected);
  newRoomButton.disabled = isConnected;
  roomInput.disabled = isConnected;
  senderRole.disabled = isConnected;
  receiverRole.disabled = isConnected;

  for (const element of senderActions) {
    element.classList.toggle("hidden", role !== "sender");
  }
}

function updateProgress(done, total) {
  const pct = total ? Math.floor((done / total) * 100) : 0;
  const seconds = startedAt ? Math.max((performance.now() - startedAt) / 1000, 0.001) : 1;

  progressArea.classList.toggle("hidden", !total && !done);
  progressBar.style.width = `${Math.min(pct, 100)}%`;
  progressText.textContent = `${pct}%`;
  speedText.textContent = `${formatBytes(done / seconds)}/s`;
  receivedText.textContent = `${formatBytes(done)}${total ? ` / ${formatBytes(total)}` : ""}`;
}

function setStatus(value) {
  connectionState.textContent = value;
  const badge = connectionState.closest(".status-badge");
  if (badge) {
    const normalized = String(value).toLowerCase();
    let statusClass = "status-default";
    if (normalized === "connected" || normalized === "ready") {
      statusClass = "status-success";
    } else if (normalized === "connecting" || normalized === "new") {
      statusClass = "status-warning";
    } else if (normalized === "failed" || normalized === "disconnected" || normalized === "closed") {
      statusClass = "status-danger";
    }
    badge.classList.remove("status-success", "status-warning", "status-danger", "status-default");
    badge.classList.add(statusClass);
  }
}

function showNotice(message) {
  noticeText.textContent = message;
}

function showIncomingModal() {
  if (!receiveMeta) {
    return;
  }

  incomingDetails.textContent = `${receiveMeta.name} · ${formatBytes(receiveMeta.size)}`;
  incomingModal.classList.remove("hidden");
}

function hideIncomingModal() {
  incomingModal.classList.add("hidden");
}

function cancelIncomingFile() {
  hideIncomingModal();
  showNotice("Incoming file was cancelled.");
  channel?.send(JSON.stringify({ type: "receiver-cancelled" }));
  receiveMeta = undefined;
  updateReceiverControls();
}

copyDiagButton.addEventListener("click", () => {
  navigator.clipboard?.writeText(diagLog.textContent).then(
    () => showNotice("Diagnostics copied to clipboard."),
    () => showNotice("Copy failed — select the log text manually.")
  );
});

clearDiagButton.addEventListener("click", resetDiagnostics);

function logDiag(message) {
  const stamp = `${(performance.now() / 1000).toFixed(2)}s`;
  const line = `[${stamp}] ${role}: ${message}`;
  if (diagLog.dataset.empty === "true") {
    diagLog.textContent = "";
    diagLog.dataset.empty = "false";
  }
  diagLog.textContent += `${line}\n`;
  diagLog.scrollTop = diagLog.scrollHeight;
  console.log("[diag]", line);
}

function resetDiagnostics() {
  sawIpv6Local = false;
  candidateCounts = { host: 0, srflx: 0, prflx: 0, relay: 0 };
  diagLog.textContent = "Logs will appear here once you press Connect.";
  diagLog.dataset.empty = "true";
  diagIpv6.textContent = "—";
  diagPath.textContent = "—";
  diagIce.textContent = "—";
  setVerdict("Connecting…", "");
}

function setVerdict(text, cls) {
  diagVerdict.textContent = text;
  diagVerdict.classList.remove("is-good", "is-bad", "is-warn");
  if (cls) {
    diagVerdict.classList.add(cls);
  }
}

function isIpv6Address(address) {
  return typeof address === "string" && address.includes(":") && !address.endsWith(".local");
}

function describeCandidate(candidate) {
  // A live RTCIceCandidate exposes parsed fields, but one received over
  // signaling is JSON and only carries the raw SDP string — so parse that.
  let type = candidate.type;
  let protocol = candidate.protocol;
  let address = candidate.address;
  let port = candidate.port;

  if ((!type || !address) && typeof candidate.candidate === "string") {
    const parts = candidate.candidate.split(" ");
    if (parts.length >= 6) {
      protocol = protocol || parts[2];
      address = address || parts[4];
      port = port || parts[5];
      const typIndex = parts.indexOf("typ");
      if (typIndex !== -1) {
        type = type || parts[typIndex + 1];
      }
    }
  }

  return {
    type: type || "?",
    protocol: protocol || "?",
    address: address || "?",
    port: port || "?",
    family: isIpv6Address(address) ? "IPv6" : "IPv4"
  };
}

function logLocalCandidate(candidate) {
  const info = describeCandidate(candidate);
  if (candidateCounts[info.type] !== undefined) {
    candidateCounts[info.type] += 1;
  }

  if (info.family === "IPv6") {
    sawIpv6Local = true;
    diagIpv6.textContent = "available";
  } else if (diagIpv6.textContent === "—") {
    diagIpv6.textContent = "IPv4 only (so far)";
  }

  logDiag(
    `local candidate · ${info.type} · ${info.family} · ${info.protocol} · ${info.address}:${info.port}`
  );
}

function summarizeCandidates(counts) {
  return `host=${counts.host} srflx=${counts.srflx} relay=${counts.relay}`;
}

async function reportSelectedPair() {
  try {
    const stats = await peer.getStats();
    let selectedPairId;
    const pairs = new Map();
    const candidates = new Map();

    stats.forEach((report) => {
      if (report.type === "transport" && report.selectedCandidatePairId) {
        selectedPairId = report.selectedCandidatePairId;
      }
      if (report.type === "candidate-pair") {
        pairs.set(report.id, report);
      }
      if (report.type === "local-candidate" || report.type === "remote-candidate") {
        candidates.set(report.id, report);
      }
    });

    let pair = selectedPairId ? pairs.get(selectedPairId) : undefined;
    if (!pair) {
      pairs.forEach((candidatePair) => {
        if (candidatePair.nominated && candidatePair.state === "succeeded") {
          pair = candidatePair;
        }
      });
    }

    if (!pair) {
      logDiag("Connected, but could not read the selected candidate pair from stats.");
      return;
    }

    const local = candidates.get(pair.localCandidateId);
    const remote = candidates.get(pair.remoteCandidateId);
    const localType = local?.candidateType || "?";
    const remoteType = remote?.candidateType || "?";
    const family = isIpv6Address(local?.address || local?.ip) ? "IPv6" : "IPv4";
    const usedRelay = localType === "relay" || remoteType === "relay";

    diagPath.textContent = `${localType}↔${remoteType} (${family})`;
    logDiag(`SELECTED PAIR · local=${localType} remote=${remoteType} · ${family} · ${local?.protocol || "?"}`);

    if (family === "IPv6") {
      setVerdict("Connected over IPv6 (no NAT)", "is-good");
      logDiag("Direct IPv6 connection — bypassed NAT entirely.");
    } else if (usedRelay) {
      setVerdict("Connected via relay (TURN)", "is-warn");
    } else if (localType === "prflx" || remoteType === "prflx") {
      setVerdict("Connected direct (peer-reflexive)", "is-good");
      logDiag("Peer-reflexive worked — the cone↔symmetric port-learning trick succeeded.");
    } else {
      setVerdict("Connected direct (STUN)", "is-good");
    }
  } catch (error) {
    logDiag(`Could not read stats: ${error.message}`);
  }
}

function createRoomId() {
  return crypto.randomUUID().slice(0, 8);
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}
