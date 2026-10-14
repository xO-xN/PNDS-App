// Optional outbound connection to the existing token-authenticated PNDS hub.
// Local performer controls never wait for this connection.
const { io } = require("socket.io-client");
const PRESENCE = "pnds:hub-presence";
const EVENT = "pnds:hub-event";
const trim = value => typeof value === "string" ? value.trim() : "";

function readHubConfig(environment = process.env, standalone = {}) {
  const host = {
    nodeId: trim(environment.PNDS_NODE_ID),
    url: trim(environment.PNDS_HUB_URL),
    token: trim(environment.PNDS_HUB_TOKEN),
    room: trim(environment.PNDS_HUB_ROOM),
  };
  // A partial Host injection cannot be masked by standalone configuration.
  return Object.values(host).some(Boolean) ? host : {
    nodeId: trim(standalone.nodeId), url: trim(standalone.url),
    token: trim(standalone.token), room: trim(standalone.room),
  };
}

function complete(config) {
  if (!Object.values(config).every(Boolean)) return false;
  try { return ["http:", "https:"].includes(new URL(config.url).protocol); }
  catch { return false; }
}

function createHubConnection({
  environment = process.env, config = {}, summary = () => null,
  onEvent = () => {}, onStatus = () => {}, onPeers = () => {},
  now = Date.now, heartbeatMs = 2000, peerOfflineMs = 8000,
  peerPruneMs = 30000, reconnectionDelayMs = 1000,
  connectionTimeoutMs = 10000,
} = {}) {
  for (const value of [heartbeatMs, peerOfflineMs, peerPruneMs, reconnectionDelayMs, connectionTimeoutMs]) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError("Hub timing options must be positive milliseconds");
  }
  if (peerPruneMs < peerOfflineMs) throw new TypeError("peerPruneMs must be at least peerOfflineMs");
  const settings = readHubConfig(environment, config);
  let socket = null, timer = null, retryTimer = null;
  let status = "idle", reason = null, everConnected = false;
  let nodeId = settings.nodeId, room = settings.room;
  const peers = new Map();

  function snapshot() {
    const at = now();
    const remote = [];
    for (const [name, peer] of peers) {
      const ageMs = Math.max(0, at - peer.lastSeenAt);
      if (ageMs > peerPruneMs) { peers.delete(name); continue; }
      remote.push({ nodeId: name, summary: structuredClone(peer.summary), lastSeenAt: peer.lastSeenAt, ageMs, online: ageMs <= peerOfflineMs });
    }
    return { status, reason, connected: status === "connected", everConnected, nodeId, room, remoteNodeCount: remote.filter(peer => peer.online).length, peers: remote };
  }
  function notify(next, cause = null) {
    status = next; reason = cause;
    onStatus(snapshot());
  }
  function announce() {
    if (status !== "connected") return false;
    try {
      const value = summary();
      JSON.stringify(value);
      socket.emit("relay", { type: PRESENCE, version: 1, summary: value });
      return true;
    } catch { return false; }
  }
  function send(event, payload) {
    if (status !== "connected" || typeof event !== "string" || !event.trim()) return false;
    try {
      JSON.stringify(payload);
      socket.emit("relay", { type: EVENT, version: 1, event, payload });
      return true;
    } catch { return false; }
  }
  function start() {
    if (socket) return;
    if (!complete(settings)) { notify("unconfigured", "missing-or-invalid-config"); return; }
    notify("connecting");
    socket = io(settings.url, {
      reconnection: true, reconnectionDelay: reconnectionDelayMs,
      reconnectionDelayMax: reconnectionDelayMs, timeout: connectionTimeoutMs,
      autoConnect: false,
      auth: { token: settings.token, room: settings.room, node: settings.nodeId },
    });
    socket.on("connect", () => {
      clearTimeout(retryTimer); retryTimer = null;
      everConnected = true;
      notify("connected");
      announce();
    });
    socket.on("welcome", welcome => {
      if (welcome && typeof welcome.node === "string" && typeof welcome.room === "string") {
        nodeId = welcome.node; room = welcome.room;
      }
    });
    socket.on("disconnect", () => notify("disconnected", "transport"));
    socket.on("connect_error", error => {
      notify(error?.message === "invalid hub token" ? "authentication-failed" : "unreachable", error?.message === "invalid hub token" ? "invalid-token" : "transport");
      // Socket.IO retries transport errors itself; middleware refusal needs an explicit retry.
      if (socket && !socket.active && !retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = null; socket?.connect(); }, reconnectionDelayMs);
      }
    });
    socket.on("relay", body => {
      if (!body || typeof body.from !== "string" || !body.from || body.from === nodeId || body.version !== 1) return;
      if (body.type === PRESENCE) {
        peers.set(body.from, { summary: body.summary ?? null, lastSeenAt: now() });
        onPeers(snapshot().peers);
      } else if (body.type === EVENT && typeof body.event === "string" && body.event.trim()) {
        onEvent(body.event, body.payload, { from: body.from, hubReceivedAt: body.hubReceivedAt });
      }
    });
    timer = setInterval(() => { announce(); onPeers(snapshot().peers); }, heartbeatMs);
    socket.connect();
  }
  function stop() {
    clearInterval(timer); clearTimeout(retryTimer);
    timer = null; retryTimer = null;
    if (socket) { socket.removeAllListeners(); socket.close(); socket = null; }
    peers.clear();
    if (status !== "stopped") { notify("stopped"); onPeers([]); }
  }
  return { start, stop, send, announce, snapshot };
}

module.exports = { readHubConfig, createHubConnection };
