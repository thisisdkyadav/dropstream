import { Sha256, sha256Hex } from "./sha256.js";

const roomInput = document.querySelector("#roomInput");
const newRoomButton = document.querySelector("#newRoomButton");
const connectButton = document.querySelector("#connectButton");
const disconnectButton = document.querySelector("#disconnectButton");
const passInput = document.querySelector("#passInput");
const passModal = document.querySelector("#passModal");
const passModalMsg = document.querySelector("#passModalMsg");
const passModalInput = document.querySelector("#passModalInput");
const passSubmitButton = document.querySelector("#passSubmitButton");
const passCancelButton = document.querySelector("#passCancelButton");
const fileInput = document.querySelector("#fileInput");
const folderInput = document.querySelector("#folderInput");
const folderButton = document.querySelector("#folderButton");
const filePicker = document.querySelector("#filePicker");
const fileCard = document.querySelector("#fileCard");
const fileCardTitle = document.querySelector("#fileCardTitle");
const fileCardSub = document.querySelector("#fileCardSub");
const fileList = document.querySelector("#fileList");
const clearFilesButton = document.querySelector("#clearFilesButton");
const sendButton = document.querySelector("#sendButton");
const textInput = document.querySelector("#textInput");
const sendTextButton = document.querySelector("#sendTextButton");
const incomingTextCard = document.querySelector("#incomingTextCard");
const incomingTextContent = document.querySelector("#incomingTextContent");
const copyTextButton = document.querySelector("#copyTextButton");
const openTextButton = document.querySelector("#openTextButton");
const connectionState = document.querySelector("#connectionState");
const statusPill = document.querySelector("#statusPill");
const transferPanel = document.querySelector("#transferPanel");
const noticeText = document.querySelector("#noticeText");
const pathChip = document.querySelector("#pathChip");
const incomingModal = document.querySelector("#incomingModal");
const incomingTitle = document.querySelector("#incomingTitle");
const incomingDetails = document.querySelector("#incomingDetails");
const modalSaveButton = document.querySelector("#modalSaveButton");
const cancelIncomingButton = document.querySelector("#cancelIncomingButton");
const progressArea = document.querySelector("#progressArea");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");
const progressSub = document.querySelector("#progressSub");
const speedText = document.querySelector("#speedText");
const receivedText = document.querySelector("#receivedText");
const qrButton = document.querySelector("#qrButton");
const qrModal = document.querySelector("#qrModal");
const qrCanvas = document.querySelector("#qrCanvas");
const qrLinkText = document.querySelector("#qrLinkText");
const copyLinkButton = document.querySelector("#copyLinkButton");
const closeQrButton = document.querySelector("#closeQrButton");

const chunkSize = 64 * 1024;
const maxBufferedAmount = 1 * 1024 * 1024;

let isInitiator = false;
let socket;
let peer;
let channel;
let selectedFiles = [];
let isConnected = false;
let transferActive = false;
let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
let wakeLock = null;
let currentRoomId = "";
let passphrase = "";
let authorized = false;
let myAuthProof = "";
let peerAuthProof = null;
let intentConnected = false;
let reconnectAttempts = 0;
let reconnectTimer;
let socketToken = 0;
let peerWasConnected = false;
const MAX_RECONNECT = 6;

// Receiver-side batch state.
let incomingBatch;
let batchTotal = 0;
let batchReceived = 0;
let currentMeta;
let currentWriter;
let currentBuffers = [];
let currentHasher;
let batchResults = [];
let dirHandle;
let singleHandle;
let usedNames = new Set();
let writeChain = Promise.resolve();
let startedAt = 0;
let receiverReadyResolve;
let receiverReadyReject;

roomInput.value = createRoomId();

newRoomButton.addEventListener("click", () => {
  roomInput.value = createRoomId();
});

connectButton.addEventListener("click", () => {
  connect().catch((error) => {
    showNotice(error.message || "Connect failed.");
    connectButton.disabled = false;
    renderUi();
  });
});
disconnectButton.addEventListener("click", disconnect);
sendButton.addEventListener("click", () => {
  sendAll().catch((error) => {
    showNotice(error.message || "Send failed.");
    releaseWakeLock();
    transferActive = false;
    setProgressSub("");
    updateSendState();
  });
});
clearFilesButton.addEventListener("click", () => setSelectedFiles([]));
sendTextButton.addEventListener("click", sendText);
textInput.addEventListener("input", updateSendState);
copyTextButton.addEventListener("click", () => {
  navigator.clipboard?.writeText(incomingTextContent.textContent).then(
    () => showNotice("Copied to clipboard."),
    () => showNotice("Copy failed — select the text manually.")
  );
});
modalSaveButton.addEventListener("click", () => {
  prepareIncomingSave().catch((error) => {
    showNotice(error.message || "Save setup failed.");
    channel?.send(JSON.stringify({ type: "declined" }));
    modalSaveButton.disabled = false;
    hideIncomingModal();
  });
});
cancelIncomingButton.addEventListener("click", cancelIncomingFile);

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});
folderButton.addEventListener("click", (event) => {
  // The button lives inside the dropzone <label>, so block the label from also
  // opening the file picker.
  event.preventDefault();
  event.stopPropagation();
  folderInput.click();
});
folderInput.addEventListener("change", () => {
  addFiles(folderInput.files);
  folderInput.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  filePicker.addEventListener(eventName, (event) => {
    event.preventDefault();
    filePicker.classList.add("dragover");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  filePicker.addEventListener(eventName, (event) => {
    event.preventDefault();
    filePicker.classList.remove("dragover");
  });
}

filePicker.addEventListener("drop", (event) => {
  addFiles(event.dataTransfer?.files);
});

qrButton.addEventListener("click", () => {
  showQrModal().catch((error) => {
    showNotice(error.message || "Could not generate QR code.");
  });
});
closeQrButton.addEventListener("click", () => qrModal.classList.add("hidden"));
qrModal.addEventListener("click", (event) => {
  if (event.target === qrModal) {
    qrModal.classList.add("hidden");
  }
});
copyLinkButton.addEventListener("click", () => {
  navigator.clipboard?.writeText(qrLinkText.textContent).then(
    () => showNotice("Link copied to clipboard."),
    () => showNotice("Copy failed — long-press the link to copy it.")
  );
});

passSubmitButton.addEventListener("click", submitPassphrase);
passCancelButton.addEventListener("click", () => {
  passModal.classList.add("hidden");
  showNotice("Enter the passphrase to unlock this room.");
});
passModalInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    submitPassphrase();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && transferActive && !wakeLock) {
    acquireWakeLock();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

renderUi();
joinFromLink();

/* ---------- Wake lock ---------- */

async function acquireWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener?.("release", () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release?.();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

/* ---------- Passphrase authorization ---------- */

function resetAuth() {
  authorized = false;
  myAuthProof = "";
  peerAuthProof = null;
  passModal.classList.add("hidden");
}

function computeProof() {
  return passphrase ? sha256Hex(`${currentRoomId} ${passphrase}`) : "";
}

function startAuth() {
  myAuthProof = computeProof();
  peerAuthProof = null;
  authorized = false;
  sendControl({ type: "auth", proof: myAuthProof });
  showNotice(passphrase ? "Verifying passphrase…" : "Connected — send files or text, or wait to receive.");
  evaluateAuth();
}

function evaluateAuth() {
  if (peerAuthProof === null) {
    return; // Peer hasn't presented its proof yet.
  }

  if (myAuthProof === peerAuthProof) {
    authorized = true;
    passModal.classList.add("hidden");
    if (passphrase) {
      showNotice("Room secured 🔒 — send or receive.");
    }
    updateSendState();
    updateReceiverControls();
    return;
  }

  authorized = false;
  updateSendState();
  updateReceiverControls();

  if (myAuthProof === "") {
    showPassModal("This room is locked. Enter the passphrase to continue.");
  } else if (peerAuthProof === "") {
    showNotice("Waiting for the other device to enter the passphrase…");
  } else {
    showPassModal("Passphrase doesn't match. Try again.");
  }
}

function showPassModal(message) {
  passModalMsg.textContent = message;
  passModalInput.value = "";
  passModal.classList.remove("hidden");
  passModalInput.focus();
}

function submitPassphrase() {
  const entered = passModalInput.value.trim();
  if (!entered) {
    return;
  }
  passphrase = entered;
  passModal.classList.add("hidden");
  if (channel?.readyState === "open") {
    myAuthProof = computeProof();
    sendControl({ type: "auth", proof: myAuthProof });
    showNotice("Verifying passphrase…");
    evaluateAuth();
  }
}

/* ---------- QR + deep link ---------- */

let qrLibPromise;

function loadQrLib() {
  qrLibPromise ??= import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
  return qrLibPromise.then((mod) => mod.default ?? mod);
}

async function showQrModal() {
  const roomId = roomInput.value.trim().toLowerCase();
  if (!/^[a-z0-9-]{4,64}$/.test(roomId)) {
    showNotice("Enter a valid room code first.");
    return;
  }

  const link = `${location.origin}/${roomId}`;

  qrLinkText.textContent = link;
  qrModal.classList.remove("hidden");

  const QRCode = await loadQrLib();
  await QRCode.toCanvas(qrCanvas, link, {
    width: 208,
    margin: 1,
    color: { dark: "#0d2b4a", light: "#ffffff" }
  });
}

function joinFromLink() {
  const linkCode = decodeURIComponent(location.pathname.slice(1)).toLowerCase();
  if (!/^[a-z0-9-]{4,64}$/.test(linkCode)) {
    return;
  }

  roomInput.value = linkCode;
  showNotice("Joining room from link…");
  connect().catch((error) => {
    showNotice(error.message || "Could not join the room.");
    connectButton.disabled = false;
    renderUi();
  });
}

/* ---------- File selection ---------- */

function addFiles(fileListLike) {
  const incoming = Array.from(fileListLike || []);
  if (incoming.length === 0) {
    return;
  }

  const seen = new Set(selectedFiles.map((file) => `${file.name}:${file.size}`));
  for (const file of incoming) {
    const key = `${file.name}:${file.size}`;
    if (!seen.has(key)) {
      seen.add(key);
      selectedFiles.push(file);
    }
  }

  renderFileSelection();
}

function setSelectedFiles(files) {
  selectedFiles = files;
  renderFileSelection();
}

function renderFileSelection() {
  const count = selectedFiles.length;
  const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  if (count === 1) {
    fileCardTitle.textContent = selectedFiles[0].name;
    fileCardSub.textContent = formatBytes(total);
  } else if (count > 1) {
    fileCardTitle.textContent = `${count} files`;
    fileCardSub.textContent = formatBytes(total);
  }

  fileList.innerHTML = "";
  if (count > 1) {
    for (const file of selectedFiles) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "file-list-name";
      name.textContent = file.name;
      const size = document.createElement("span");
      size.className = "file-list-size";
      size.textContent = formatBytes(file.size);
      li.append(name, size);
      fileList.append(li);
    }
  }
  fileList.classList.toggle("hidden", count <= 1);

  if (count > 0) {
    showNotice(`${count} file${count > 1 ? "s" : ""} ready to send.`);
  }
  updateSendState();
  renderUi();
}

/* ---------- Connection ---------- */

async function connect() {
  teardown();
  resetTransfer();
  setPathChip(null);

  const roomId = roomInput.value.trim().toLowerCase();
  if (!/^[a-z0-9-]{4,64}$/.test(roomId)) {
    showNotice("Room code must be 4-64 letters, numbers, or dashes.");
    return;
  }

  currentRoomId = roomId;
  passphrase = passInput.value.trim();
  resetAuth();

  intentConnected = true;
  reconnectAttempts = 0;
  clearTimeout(reconnectTimer);
  connectButton.disabled = true;
  renderUi();

  await openSocket();
}

async function openSocket() {
  const token = ++socketToken;
  await loadIceServers();
  if (token !== socketToken) {
    return; // A newer attempt superseded this one.
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/api/room/${currentRoomId}`);

  socket.addEventListener("open", () => {
    if (token !== socketToken) {
      return;
    }
    isConnected = true;
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    peerWasConnected = false;
    setStatus("Connecting");
    showNotice("Waiting for the other device…");
    renderUi();
    // The peer is created once the room assigns our slot (the "ready" message),
    // since that tells us whether we are the WebRTC initiator.
  });
  socket.addEventListener("message", (event) => {
    if (token === socketToken) {
      handleSignal(event);
    }
  });
  socket.addEventListener("close", () => {
    if (token === socketToken) {
      onSocketClosed();
    }
  });
  socket.addEventListener("error", () => {
    if (token === socketToken) {
      console.warn("[ws] socket error");
    }
  });
}

function onSocketClosed() {
  isConnected = false;
  if (!intentConnected) {
    setStatus("Offline");
    showNotice("Connect to start a room.");
    connectButton.disabled = false;
    renderUi();
    return;
  }
  triggerReconnect();
}

function triggerReconnect() {
  if (!intentConnected) {
    return;
  }
  teardown();
  scheduleReconnect();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts += 1;

  if (reconnectAttempts > MAX_RECONNECT) {
    intentConnected = false;
    isConnected = false;
    setStatus("Failed");
    showNotice("Couldn't reconnect. Tap Connect to retry.");
    connectButton.disabled = false;
    renderUi();
    return;
  }

  const delay = Math.min(800 * 2 ** (reconnectAttempts - 1), 8000);
  isConnected = false;
  setStatus("Connecting");
  setPathChip(null);
  showNotice(`Connection lost — reconnecting (attempt ${reconnectAttempts})…`);
  connectButton.disabled = true;
  renderUi();
  reconnectTimer = setTimeout(() => {
    openSocket();
  }, delay);
}

// Close peer + socket without changing connection intent. Bumping the token
// makes the closing socket's handlers no-ops so teardown never re-triggers a
// reconnect by itself.
function teardown() {
  socketToken += 1;
  try { channel?.close(); } catch { /* ignore */ }
  try { peer?.close(); } catch { /* ignore */ }
  try { socket?.close(); } catch { /* ignore */ }
  channel = undefined;
  peer = undefined;
  socket = undefined;
  peerWasConnected = false;
  releaseWakeLock();
}

// The other side left but our socket is still up: rebuild a fresh peer so we
// re-handshake cleanly when they return (the sender re-offers on presence).
function recreatePeer() {
  try { channel?.close(); } catch { /* ignore */ }
  try { peer?.close(); } catch { /* ignore */ }
  channel = undefined;
  peer = undefined;
  peerWasConnected = false;
  resetTransfer();
  resetAuth();
  createPeer();
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
      console.debug("[ice] loaded servers", iceServers);
      return;
    }
    throw new Error("empty config");
  } catch (error) {
    iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    console.warn(`[ice] TURN config unavailable (${error.message}); STUN only.`);
  }
}

function createPeer() {
  peer = new RTCPeerConnection({ iceServers });

  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      console.debug("[ice] local", describeCandidate(event.candidate));
      signal({ type: "candidate", candidate: event.candidate });
    }
  });

  peer.addEventListener("icecandidateerror", (event) => {
    // 401 = TURN credentials rejected, 701 = server unreachable.
    console.warn(`[ice] server error code=${event.errorCode} "${event.errorText || ""}" ${event.url || ""}`);
  });

  peer.addEventListener("iceconnectionstatechange", () => {
    console.debug(`[ice] connection: ${peer.iceConnectionState}`);
  });

  peer.addEventListener("connectionstatechange", () => {
    if (!peer) {
      return;
    }
    setStatus(peer.connectionState);
    if (peer.connectionState === "connected") {
      peerWasConnected = true;
      showNotice("Connected — send files or text, or wait to receive.");
      reportSelectedPair();
    }
    if (peer.connectionState === "failed" && intentConnected) {
      // Re-join the room so presence fires and both sides re-handshake.
      showNotice("Connection dropped — reconnecting…");
      triggerReconnect();
      return;
    }
    updateSendState();
    renderUi();
  });

  peer.addEventListener("datachannel", (event) => {
    setupChannel(event.channel);
  });

  if (isInitiator) {
    setupChannel(peer.createDataChannel("file", { ordered: true }));
  }
}

async function handleSignal(event) {
  const message = JSON.parse(event.data);

  if (message.type === "ready") {
    // The room assigned our slot; "a" is the WebRTC initiator.
    isInitiator = Boolean(message.initiator);
    createPeer();
    return;
  }

  if (message.type === "presence") {
    const otherPresent = message.count === 2;

    if (!otherPresent) {
      // If we were connected and the other side dropped, rebuild a fresh peer
      // so we cleanly re-handshake when they reconnect.
      if (peerWasConnected) {
        showNotice("The other device dropped — waiting for it to return…");
        recreatePeer();
      } else {
        showNotice("Waiting for the other device…");
      }
      return;
    }

    if (isInitiator && peer && !peer.localDescription) {
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
    if (message.candidate) {
      console.debug("[ice] remote", describeCandidate(message.candidate));
    }
    try {
      await peer.addIceCandidate(message.candidate);
    } catch (error) {
      console.warn(`[ice] addIceCandidate failed: ${error.message}`);
    }
  }
}

function setupChannel(nextChannel) {
  channel = nextChannel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = maxBufferedAmount / 2;

  channel.addEventListener("open", () => {
    setStatus("Ready");
    startAuth();
    updateSendState();
    updateReceiverControls();
    renderUi();
  });

  channel.addEventListener("close", () => {
    releaseWakeLock();
    updateSendState();
    updateReceiverControls();
    renderUi();
  });

  channel.addEventListener("message", (event) => {
    receiveData(event).catch((error) => {
      showNotice(error.message || "Receive failed.");
    });
  });
}

/* ---------- Sending ---------- */

async function sendAll() {
  if (selectedFiles.length === 0 || !channel || channel.readyState !== "open") {
    return;
  }
  if (!authorized) {
    showNotice("Unlock the room with the passphrase before sending.");
    return;
  }
  if (transferActive || incomingBatch) {
    showNotice("Wait for the current transfer to finish.");
    return;
  }

  const files = selectedFiles;
  const total = files.reduce((sum, file) => sum + file.size, 0);

  await acquireWakeLock();
  resetProgress();
  startedAt = performance.now();
  transferActive = true;

  sendControl({
    type: "batch",
    totalBytes: total,
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream"
    }))
  });

  showNotice(`Waiting for the receiver to accept ${files.length} file${files.length > 1 ? "s" : ""}…`);
  await waitForReceiverReady();

  let sent = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    sendControl({
      type: "file-start",
      index,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream"
    });
    setProgressSub(`File ${index + 1} of ${files.length} · ${file.name}`);

    const hasher = new Sha256();
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
      hasher.update(chunk);
      await sendBinary(chunk);
      sent += chunk.byteLength;
      updateProgress(sent, total);
    }

    await waitForBuffer(0);
    sendControl({ type: "file-end", index, sha256: hasher.digestHex() });
  }

  sendControl({ type: "batch-done" });
  releaseWakeLock();
  transferActive = false;
  setProgressSub("");
  showNotice(`Sent ${files.length} file${files.length > 1 ? "s" : ""}.`);
  updateSendState();
}

function sendText() {
  const content = textInput.value.trim();
  if (!content || !channel || channel.readyState !== "open") {
    return;
  }
  if (!authorized) {
    showNotice("Unlock the room with the passphrase before sending.");
    return;
  }

  channel.send(JSON.stringify({ type: "text", content }));
  textInput.value = "";
  updateSendState();
  showNotice("Text sent.");
}

/* ---------- Receiving ---------- */

async function receiveData(event) {
  if (typeof event.data === "string") {
    const message = JSON.parse(event.data);
    await handleControl(message);
    return;
  }

  currentHasher?.update(event.data);

  if (currentWriter) {
    writeChain = writeChain.then(() => currentWriter.write(event.data));
    await writeChain;
  } else {
    currentBuffers.push(event.data);
  }

  batchReceived += event.data.byteLength;
  updateProgress(batchReceived, batchTotal);
}

async function handleControl(message) {
  if (message.type === "auth") {
    peerAuthProof = message.proof ?? "";
    evaluateAuth();
    return;
  }

  if (message.type === "text") {
    showIncomingText(message.content);
    showNotice("Received a text message.");
    return;
  }

  if (message.type === "batch") {
    incomingBatch = message;
    batchTotal = message.totalBytes || 0;
    batchReceived = 0;
    batchResults = [];
    usedNames = new Set();
    dirHandle = undefined;
    singleHandle = undefined;
    currentWriter = undefined;
    currentBuffers = [];
    writeChain = Promise.resolve();
    startedAt = performance.now();
    resetProgress();
    showIncomingModal();
    showNotice("Incoming files are ready to accept.");
    return;
  }

  if (message.type === "ready") {
    receiverReadyResolve?.();
    receiverReadyResolve = undefined;
    receiverReadyReject = undefined;
    return;
  }

  if (message.type === "declined") {
    receiverReadyReject?.(new Error("Receiver declined the transfer."));
    receiverReadyResolve = undefined;
    receiverReadyReject = undefined;
    return;
  }

  if (message.type === "file-start") {
    currentMeta = message;
    setProgressSub(`File ${message.index + 1} of ${incomingBatch?.files?.length || 1} · ${message.name}`);
    currentBuffers = [];
    currentHasher = new Sha256();

    if (dirHandle) {
      const name = uniqueName(message.name);
      const handle = await dirHandle.getFileHandle(name, { create: true });
      currentWriter = await handle.createWritable();
    } else if (singleHandle) {
      currentWriter = await singleHandle.createWritable();
    } else {
      currentWriter = undefined;
    }
    return;
  }

  if (message.type === "file-end") {
    const actual = currentHasher ? currentHasher.digestHex() : "";
    currentHasher = undefined;
    const expected = message.sha256 || "";
    const verified = Boolean(expected);
    const ok = !verified || actual === expected;
    batchResults.push({ name: currentMeta?.name || "file", verified, ok });
    if (verified && !ok) {
      console.warn(`[integrity] ${currentMeta?.name}: expected ${expected}, got ${actual}`);
    }

    if (currentWriter) {
      await writeChain;
      await currentWriter.close();
      currentWriter = undefined;
    } else {
      const blob = new Blob(currentBuffers, {
        type: currentMeta?.mime || "application/octet-stream"
      });
      downloadBlob(blob, currentMeta?.name || "download");
      currentBuffers = [];
    }
    return;
  }

  if (message.type === "batch-done") {
    const count = incomingBatch?.files?.length || 0;
    hideIncomingModal();
    releaseWakeLock();
    transferActive = false;
    setProgressSub("");

    const failed = batchResults.filter((result) => !result.ok);
    const verifiedCount = batchResults.filter((result) => result.verified && result.ok).length;
    if (failed.length > 0) {
      showNotice(`⚠ ${failed.length} of ${count} file${count !== 1 ? "s" : ""} failed the integrity check.`);
    } else if (verifiedCount === count && count > 0) {
      showNotice(`Received ${count} file${count !== 1 ? "s" : ""} — verified ✓`);
    } else {
      showNotice(`Received ${count} file${count !== 1 ? "s" : ""}.`);
    }

    incomingBatch = undefined;
    updateReceiverControls();
    updateSendState();
  }
}

async function prepareIncomingSave() {
  if (!incomingBatch || !channel || channel.readyState !== "open") {
    return;
  }
  if (!authorized) {
    showNotice("Unlock the room with the passphrase first.");
    return;
  }

  modalSaveButton.disabled = true;
  const count = incomingBatch.files.length;

  if (count > 1 && "showDirectoryPicker" in window) {
    dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  } else if (count === 1 && "showSaveFilePicker" in window) {
    singleHandle = await window.showSaveFilePicker({
      suggestedName: incomingBatch.files[0].name
    });
  } else {
    showNotice("Files will download once each one finishes.");
  }

  await acquireWakeLock();
  transferActive = true;
  channel.send(JSON.stringify({ type: "ready" }));
  hideIncomingModal();
  updateSendState();
  showNotice("Receiving files…");
}

function waitForReceiverReady() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      receiverReadyResolve = undefined;
      receiverReadyReject = undefined;
      reject(new Error("Receiver did not respond in time."));
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

function uniqueName(rawName) {
  const base = String(rawName).split(/[\\/]/).pop() || "file";
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }

  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let counter = 1;
  let candidate = `${stem} (${counter})${ext}`;
  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${stem} (${counter})${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showIncomingText(content) {
  incomingTextContent.textContent = content;
  const isLink = /^https?:\/\/\S+$/i.test(content.trim());
  if (isLink) {
    openTextButton.href = content.trim();
    openTextButton.classList.remove("hidden");
  } else {
    openTextButton.classList.add("hidden");
  }
  incomingTextCard.classList.remove("hidden");
}

/* ---------- Channel plumbing ---------- */

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
  intentConnected = false;
  reconnectAttempts = 0;
  clearTimeout(reconnectTimer);
  teardown();
  isConnected = false;
  resetAuth();
  setStatus("Offline");
  setPathChip(null);
  hideIncomingModal();
  showNotice("Connect to start a room.");
  connectButton.disabled = false;
  updateSendState();
  updateReceiverControls();
  renderUi();
}

function resetTransfer() {
  incomingBatch = undefined;
  batchTotal = 0;
  batchReceived = 0;
  currentMeta = undefined;
  currentWriter = undefined;
  currentBuffers = [];
  currentHasher = undefined;
  batchResults = [];
  dirHandle = undefined;
  singleHandle = undefined;
  usedNames = new Set();
  writeChain = Promise.resolve();
  receiverReadyResolve = undefined;
  receiverReadyReject = undefined;
  startedAt = 0;
  transferActive = false;
  incomingTextCard.classList.add("hidden");
  resetProgress();
  updateReceiverControls();
  hideIncomingModal();
}

function resetProgress() {
  transferActive = false;
  setProgressSub("");
  updateProgress(0, 0);
}

/* ---------- UI state ---------- */

function updateSendState() {
  // Either peer can send, but only one transfer at a time (the progress UI and
  // receive buffers are shared), so block sending while a transfer is active or
  // an incoming batch is awaiting acceptance.
  const ready = channel?.readyState === "open" && authorized && !transferActive && !incomingBatch;
  sendButton.disabled = !ready || selectedFiles.length === 0;
  sendTextButton.disabled = !ready || textInput.value.trim().length === 0;
}

function updateReceiverControls() {
  modalSaveButton.disabled = !incomingBatch || channel?.readyState !== "open" || !authorized;
}

function renderUi() {
  // Treat an in-progress reconnect (intentConnected, not yet isConnected) as
  // "live" so the Disconnect control stays available to cancel it.
  const live = intentConnected;
  transferPanel.classList.toggle("hidden", !live);
  disconnectButton.classList.toggle("hidden", !live);
  connectButton.classList.toggle("hidden", live);
  newRoomButton.disabled = live;
  roomInput.disabled = live;
  passInput.disabled = live;

  fileCard.classList.toggle("hidden", selectedFiles.length === 0);
}

function updateProgress(done, total) {
  const pct = total ? Math.floor((done / total) * 100) : 0;
  const seconds = startedAt ? Math.max((performance.now() - startedAt) / 1000, 0.001) : 1;

  transferActive = transferActive || Boolean(total || done);
  progressArea.classList.toggle("hidden", !transferActive);
  progressBar.style.width = `${Math.min(pct, 100)}%`;
  progressText.textContent = `${pct}%`;
  speedText.textContent = `${formatBytes(done / seconds)}/s`;
  receivedText.textContent = `${formatBytes(done)}${total ? ` / ${formatBytes(total)}` : ""}`;
}

function setProgressSub(text) {
  progressSub.textContent = text;
  progressSub.classList.toggle("hidden", !text);
}

function setStatus(value) {
  const normalized = String(value).toLowerCase();
  const labels = {
    connected: "Connected",
    ready: "Ready",
    connecting: "Connecting",
    new: "Connecting",
    failed: "Failed",
    disconnected: "Disconnected",
    closed: "Closed",
    offline: "Offline"
  };
  connectionState.textContent = labels[normalized] || value;

  let state = "idle";
  if (normalized === "connected" || normalized === "ready") {
    state = "good";
  } else if (normalized === "connecting" || normalized === "new") {
    state = "warn";
  } else if (normalized === "failed" || normalized === "disconnected" || normalized === "closed") {
    state = "bad";
  }
  statusPill.dataset.state = state;
}

function setPathChip(kind) {
  pathChip.classList.toggle("hidden", !kind);
  pathChip.classList.remove("direct", "relay");
  if (kind) {
    pathChip.classList.add(kind);
    pathChip.textContent = kind === "relay" ? "Relayed" : "Direct P2P";
  }
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

  return `${type || "?"} ${protocol || "?"} ${address || "?"}:${port || "?"}`;
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
      return;
    }

    const local = candidates.get(pair.localCandidateId);
    const remote = candidates.get(pair.remoteCandidateId);
    const localType = local?.candidateType || "?";
    const remoteType = remote?.candidateType || "?";
    const usedRelay = localType === "relay" || remoteType === "relay";

    console.debug(`[ice] selected pair local=${localType} remote=${remoteType}`);
    setPathChip(usedRelay ? "relay" : "direct");
  } catch (error) {
    console.warn(`[ice] could not read stats: ${error.message}`);
  }
}

function showNotice(message) {
  noticeText.textContent = message;
}

function showIncomingModal() {
  if (!incomingBatch) {
    return;
  }

  const count = incomingBatch.files.length;
  if (count === 1) {
    incomingTitle.textContent = "Incoming file";
    incomingDetails.textContent = `${incomingBatch.files[0].name} · ${formatBytes(batchTotal)}`;
  } else {
    incomingTitle.textContent = "Incoming files";
    incomingDetails.textContent = `${count} files · ${formatBytes(batchTotal)}`;
  }
  modalSaveButton.disabled = false;
  incomingModal.classList.remove("hidden");
}

function hideIncomingModal() {
  incomingModal.classList.add("hidden");
}

function cancelIncomingFile() {
  hideIncomingModal();
  showNotice("Incoming transfer declined.");
  channel?.send(JSON.stringify({ type: "declined" }));
  incomingBatch = undefined;
  updateReceiverControls();
  updateSendState();
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
