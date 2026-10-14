const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { io } = require("socket.io-client");

const {
  freqRange,
  registers,
  events: EVENTS,
  tokenKey,
  monitorNamespace,
} = require("../public/shared");
const { connectPerformer, connectMonitor } = require("../public/client");
const { loadManifest, resolveServerConfig } = require("../lib/config");

const PROJECT_ROOT = path.join(__dirname, "..");
const manifest = loadManifest(PROJECT_ROOT);
const SERVER_CONFIG = resolveServerConfig(manifest);
const PERFORMER_URL = `http://127.0.0.1:${SERVER_CONFIG.performerPort}`;
const MONITOR_URL = `http://127.0.0.1:${SERVER_CONFIG.monitorPort}`;
const HEALTH_URL = `${PERFORMER_URL}/__pnds/health`;

// Parses the __config.js injection into its JSON object.
function parseConfigScript(source) {
  return JSON.parse(
    source.replace(/^window\.__PNDS_CONFIG__ = /, "").replace(/;$/, ""),
  );
}

// A minimal forwarding entry for the #138 contract: one external origin
// in front of the performer server — plain HTTP re-issued upstream and
// WebSocket upgrades byte-piped after the rewrite. The same transport
// shape the App's future HTTPS gateway presents to phones.
//
// Polling requests must each ride their OWN upstream connection
// (Connection: close, no keep-alive agent): pooling them onto one
// socket upsets engine.io's polling → websocket upgrade negotiation,
// which expects browser-style one-request-per-connection polls.
const pollAgent = new http.Agent({ keepAlive: false });

function createForwardingEntry(targetPort) {
  // Upgraded connections (the websocket pipes): Node's close() waits
  // for them and closeAllConnections() refuses to touch them, so the
  // entry owns them itself — closeUpgraded() drops them on teardown.
  const upgraded = new Set();
  const server = http.createServer((request, response) => {
    const headers = {
      ...request.headers,
      host: `127.0.0.1:${targetPort}`,
      connection: "close",
    };
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        method: request.method,
        path: request.url,
        headers,
        agent: pollAgent,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );

    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });

  server.on("upgrade", (request, socket, head) => {
    upgraded.add(socket);
    socket.on("close", () => upgraded.delete(socket));

    const upstream = net.connect({ port: targetPort, host: "127.0.0.1" }, () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`];

      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index];

        lines.push(
          name.toLowerCase() === "host"
            ? `Host: 127.0.0.1:${targetPort}`
            : `${name}: ${request.rawHeaders[index + 1]}`,
        );
      }

      upstream.write(lines.join("\r\n") + "\r\n\r\n");

      if (head.length > 0) {
        upstream.write(head);
      }

      socket.pipe(upstream);
      upstream.pipe(socket);
    });

    // Symmetric cleanup: whichever end goes away (client teardown, the
    // upstream server stopping), destroy the other — a half-open pipe
    // would hold the score server's io.close() open forever.
    const drop = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on("error", drop);
    upstream.on("close", drop);
    socket.on("error", drop);
    socket.on("close", drop);
  });

  return {
    server,
    closeUpgraded() {
      for (const socket of upgraded) {
        socket.destroy();
      }
    },
  };
}

function waitForHealthReady() {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const tick = async () => {
      attempts += 1;

      try {
        const response = await fetch(HEALTH_URL);
        const payload = await response.json();

        if (payload.status === "ready") {
          resolve(payload);
          return;
        }
      } catch {
        // server not up yet
      }

      if (attempts >= 40) {
        reject(new Error("server never reported health ready"));
        return;
      }

      setTimeout(tick, 250);
    };

    tick();
  });
}

function joinWithToken(token, url = PERFORMER_URL, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { reconnection: false, ...options });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("join timeout"));
    }, 5000);

    socket.on("connect", () => {
      socket.emit(EVENTS.join, { token: token || null });
    });

    socket.on(EVENTS.joined, (data) => {
      clearTimeout(timer);
      resolve({ socket, data });
    });

    socket.on(EVENTS.rejected, (data) => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(`rejected: ${data.reason}`));
    });
  });
}

// Waits for the next "state" broadcast that satisfies the predicate.
// (The server also broadcasts on join, so a plain once() can catch a stale
// snapshot.)
function waitForState(socket, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(EVENTS.state, onState);
      reject(new Error("state timeout"));
    }, timeoutMs);

    const onState = (data) => {
      if (predicate(data)) {
        clearTimeout(timer);
        resolve(data);
      }
    };

    socket.on(EVENTS.state, onState);
  });
}

// Polls a predicate until it holds (the client module surfaces state
// through getters, not promises).
async function waitForCondition(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return false;
}

// localStorage stand-in for the client module (the browser pages inject
// the real one).
function createClientStorage() {
  const entries = new Map();

  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, value);
    },
    entries,
  };
}

// Fails fast with an actionable message when a dev server already holds
// the ports — otherwise health polling would silently test THAT server
// and fail with confusing assertion mismatches (wrong audio mode, etc.).
async function assertPortsFree() {
  for (const port of [SERVER_CONFIG.performerPort, SERVER_CONFIG.monitorPort]) {
    const inUse = await new Promise((resolve) => {
      const probe = net.connect({ port, host: "127.0.0.1" });

      probe.once("connect", () => {
        probe.destroy();
        resolve(true);
      });
      probe.once("error", () => resolve(false));
    });

    if (inUse) {
      throw new Error(
        `Port ${port} is already in use — stop running dev servers (npm run dev / dev:none) before the integration test.`,
      );
    }
  }
}

test("score server: health, join, control, set-out, reconnect, restart seats, reset-ids, pages", async (t) => {
  await assertPortsFree();

  // Seat records survive a restart via this file — both server spawns
  // below share it, which is exactly what reopening a work does.
  const seatsFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pnds-seats-e2e-")),
    "seats.json",
  );

  const spawnServer = () =>
    spawn(process.execPath, ["server.js", "--audio-mode", "none"], {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
      env: { ...process.env, PNDS_SEATS_FILE: seatsFile },
    });

  const servers = [spawnServer()];

  t.after(() => {
    for (const server of servers) {
      server.kill("SIGTERM");
    }
  });

  const server = servers[0];

  const health = await waitForHealthReady();

  assert.equal(health.projectId, manifest.id);
  assert.equal(health.audioMode, "none");
  assert.equal(health.scoreServer.performerPort, SERVER_CONFIG.performerPort);
  assert.equal(health.scoreServer.monitorPort, SERVER_CONFIG.monitorPort);

  // --- join: first client gets id 1 + a claim token ---
  const first = await joinWithToken(null);
  t.after(() => first.socket.close());

  assert.equal(first.data.id, 1);
  assert.equal(typeof first.data.token, "string");
  assert.equal(first.data.token.length, 48);

  // --- control: monitor receives amp (audio-taper curve) and freq ---
  first.socket.emit(EVENTS.control, { amp: 0.5, freq: 0.5 });

  const expectedMidFreq = Math.round(
    freqRange.min + 0.5 * (freqRange.max - freqRange.min),
  );

  const controlState = await waitForState(
    first.socket,
    (state) =>
      state.clients.length === 1 &&
      state.clients[0].id === 1 &&
      state.clients[0].amp === 0.25 && // mapAmp(0.5) = 0.5^2
      state.clients[0].freq === expectedMidFreq, // freqRange.min + 0.5 * (max - min)
  );

  assert.equal(controlState.clients[0].amp, 0.25);
  assert.equal(controlState.clients[0].freq, expectedMidFreq);

  // --- register: a control with range 2 maps over register 2's band ---
  first.socket.emit(EVENTS.control, { amp: 0.5, freq: 0.5, range: 2 });

  const expectedR2MidFreq = Math.round(
    registers[2].freqRange.min +
      0.5 * (registers[2].freqRange.max - registers[2].freqRange.min),
  );

  const registerState = await waitForState(
    first.socket,
    (state) =>
      state.clients.length === 1 && state.clients[0].register === 2,
  );

  assert.equal(registerState.clients[0].freq, expectedR2MidFreq);

  // --- set-out: channel reassignment is reflected ---
  first.socket.emit(EVENTS.setOut, { out: 5 });

  const outState = await waitForState(
    first.socket,
    (state) => state.clients.length === 1 && state.clients[0].out === 5,
  );

  assert.equal(outState.clients[0].out, 5);

  // --- operator set-out: a socket that never joined (the monitor page)
  // reassigns a client by naming the id ---
  const operator = io(PERFORMER_URL, { reconnection: false });
  t.after(() => operator.close());

  await new Promise((resolve) => operator.on("connect", resolve));

  operator.emit(EVENTS.setOut, { id: 1, out: 6 });

  const operatorState = await waitForState(
    first.socket,
    (state) => state.clients.length === 1 && state.clients[0].out === 6,
  );

  assert.equal(operatorState.clients[0].out, 6);

  // --- second client: id 2, default channel 2 (even id) ---
  const second = await joinWithToken(null);
  t.after(() => second.socket.close());

  assert.equal(second.data.id, 2);

  second.socket.emit(EVENTS.control, { amp: 0.25, freq: 0 });

  const secondState = await waitForState(
    first.socket,
    (state) => state.clients.length === 2 && state.clients[1].id === 2,
  );

  // The join broadcast carries the birth default and the control
  // broadcast the mapped raw-0 — both are mapFreq(0), so the assertion
  // holds whichever lands first (they can coalesce into one TCP frame).
  assert.equal(
    secondState.clients[1].freq,
    Math.round(freqRange.min),
  ); // freqValue 0 → register 3 min, rounded by mapFreq
  assert.equal(secondState.clients[1].out, 2); // even id -> channel 2

  // --- register 1 for the second client ---
  second.socket.emit(EVENTS.control, { amp: 0.25, freq: 0, range: 1 });

  const secondRegisterState = await waitForState(
    first.socket,
    (state) =>
      state.clients.length === 2 && state.clients[1].register === 1,
  );

  assert.equal(
    secondRegisterState.clients[1].freq,
    Math.round(registers[1].freqRange.min), // freqValue 0 → register 1 min
  );

  // --- reconnect with token recovers id 1 AND its register ---
  first.socket.close();

  const rejoined = await joinWithToken(first.data.token);
  t.after(() => rejoined.socket.close());

  assert.equal(rejoined.data.id, 1);
  assert.equal(rejoined.data.recovered, true);

  const rejoinedState = await waitForState(
    rejoined.socket,
    (state) => {
      // Voice insertion order flips after a reconnect (voices is a Map
      // keyed by id), so find the restored client by id.
      const client = (state.clients || []).find((entry) => entry.id === 1);
      return Boolean(client && client.register === 2);
    },
  );

  const restored = rejoinedState.clients.find((entry) => entry.id === 1);

  // The voice is restored by re-mapping the RAW fader values: register 2,
  // freq 0.5 → register 2 mid, amp 0.5 → 0.25 (no double mapping).
  assert.equal(restored.register, 2);
  assert.equal(restored.freq, expectedR2MidFreq);
  assert.equal(restored.amp, 0.25);

  // --- client module: the pages' connection code against the real server ---
  // join (token persisted), deadband over the wire, monitor view,
  // operator set-out reaching the performer status, reload recovery.
  const clientStorage = createClientStorage();
  // Same-origin seam (#138): the page passes the origin that served it.
  const performerClient = connectPerformer({
    io,
    origin: PERFORMER_URL,
    events: EVENTS,
    tokenKey,
    storage: clientStorage,
  });
  t.after(() => performerClient.close());

  assert.ok(await waitForCondition(() => performerClient.joined));
  assert.equal(performerClient.myId, 3); // ids 1 and 2 are taken
  assert.equal(typeof clientStorage.entries.get(tokenKey), "string");

  // State is broadcast only on mutations, so the monitor must be fully
  // connected before the control it is meant to observe.
  const monitorClient = connectMonitor({
    io,
    port: SERVER_CONFIG.performerPort,
    events: EVENTS,
    hostname: "127.0.0.1",
    monitorNamespace,
  });
  t.after(() => monitorClient.close());

  assert.ok(await waitForCondition(() => monitorClient.connected));

  // The deadband: the first payload goes out, sub-threshold jitter does not.
  assert.equal(
    performerClient.sendControls({ amp: 0.5, freq: 0.5, range: 3 }),
    true,
  );
  assert.equal(
    performerClient.sendControls({ amp: 0.5001, freq: 0.5, range: 3 }),
    false,
  );

  // The control crossed the wire: the monitor sees amp 0.25 (0.5 mapped
  // once by the server's audio taper).
  assert.ok(
    await waitForCondition(() => {
      const mine = monitorClient.clients.find((entry) => entry.id === 3);
      return Boolean(mine && mine.amp === 0.25);
    }),
  );

  // Operator channel reassignment reaches the performer's myOut tracking.
  monitorClient.setOut(3, 6);

  assert.ok(await waitForCondition(() => performerClient.myOut === 6));

  // --- monitor view state: server-held, snapshot on connect, set
  // broadcasts to every copy, performers never hear it ---
  // The monitor's own snapshot arrived with its connect (the defaults —
  // nothing has been set yet).
  assert.ok(await waitForCondition(() => monitorClient.viewState !== null));
  assert.deepStrictEqual(monitorClient.viewState, { showQr: true });

  // A second copy (the projection window / another browser tab) starts
  // from the same snapshot.
  const projectionCopy = connectMonitor({
    io,
    port: SERVER_CONFIG.performerPort,
    events: EVENTS,
    hostname: "127.0.0.1",
    monitorNamespace,
  });
  t.after(() => projectionCopy.close());

  assert.ok(await waitForCondition(() => projectionCopy.viewState !== null));
  assert.deepStrictEqual(projectionCopy.viewState, { showQr: true });

  // One copy's adjustment reaches the other; the sender re-renders from
  // the same broadcast it triggered.
  monitorClient.setViewState("showQr", false);

  assert.ok(
    await waitForCondition(() => projectionCopy.viewState.showQr === false),
  );
  assert.strictEqual(monitorClient.viewState.showQr, false);

  // A fresh connection (⌘⇧R reload, projection opened mid-show) receives
  // the CURRENT state, not the defaults — "reload loses nothing" is this
  // same new-connection seam.
  const reloadedMonitor = connectMonitor({
    io,
    port: SERVER_CONFIG.performerPort,
    events: EVENTS,
    hostname: "127.0.0.1",
    monitorNamespace,
  });
  t.after(() => reloadedMonitor.close());

  assert.ok(
    await waitForCondition(
      () =>
        reloadedMonitor.viewState !== null &&
        reloadedMonitor.viewState.showQr === false,
    ),
  );

  // Undeclared keys stay page-local: the server ignores the set — no
  // broadcast, no mutation.
  monitorClient.setViewState("debug", true);
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.ok(!("debug" in monitorClient.viewState));
  assert.strictEqual(monitorClient.viewState.showQr, false);

  // Performers never hear the channel: a joined performer counts zero
  // view-state events while another set converges all copies.
  const performerWitness = await joinWithToken(null);
  let witnessEvents = 0;

  performerWitness.socket.on(EVENTS.monitorSnapshot, () => {
    witnessEvents += 1;
  });
  performerWitness.socket.on(EVENTS.monitorState, () => {
    witnessEvents += 1;
  });

  monitorClient.setViewState("showQr", true);

  assert.ok(
    await waitForCondition(() => monitorClient.viewState.showQr === true),
  );
  assert.ok(
    await waitForCondition(() => projectionCopy.viewState.showQr === true),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(witnessEvents, 0);

  performerWitness.socket.close();

  // A fresh client with the same storage (page reload / phone lock)
  // recovers the same id.
  performerClient.close();

  const reloaded = connectPerformer({
    io,
    origin: PERFORMER_URL,
    events: EVENTS,
    tokenKey,
    storage: clientStorage,
  });
  t.after(() => reloaded.close());

  assert.ok(await waitForCondition(() => reloaded.joined));
  assert.equal(reloaded.myId, 3);

  // --- restart: a reopened work hands the device back its seat and CH ---
  // The seat file is the only state that crosses the restart: the token
  // reclaims id 3 with channel 6 (set by the operator above), while the
  // fader state (amp/freq) starts from zero — in-memory by design.
  reloaded.close();
  monitorClient.close();

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    server.kill("SIGTERM");
  });

  const server2 = spawnServer();
  servers.push(server2);

  await waitForHealthReady();

  const performerToken = clientStorage.entries.get(tokenKey);
  const seatRejoined = await joinWithToken(performerToken);
  t.after(() => seatRejoined.socket.close());

  assert.equal(seatRejoined.data.id, 3); // the recorded seat
  assert.equal(seatRejoined.data.recovered, false); // no in-memory state

  const seatState = await waitForState(
    seatRejoined.socket,
    (state) =>
      state.clients.length === 1 &&
      state.clients[0].id === 3 &&
      state.clients[0].out === 6,
  );

  assert.equal(seatState.clients[0].amp, 0); // fader state did not survive

  const resetOperator = io(PERFORMER_URL, { reconnection: false });
  t.after(() => resetOperator.close());

  await new Promise((resolve) => resetOperator.on("connect", resolve));

  // --- seat move: the operator moves the device to another seat ---
  const movedJoined = new Promise((resolve) =>
    seatRejoined.socket.once(EVENTS.joined, resolve),
  );

  resetOperator.emit(EVENTS.setSeat, { id: 3, to: 2 });

  const movedPayload = await movedJoined;

  assert.equal(movedPayload.id, 2); // the page's id tracking follows joined
  assert.equal(movedPayload.token, performerToken);

  await waitForState(
    seatRejoined.socket,
    (state) =>
      state.clients.length === 1 &&
      state.clients[0].id === 2 &&
      state.clients[0].out === 6, // the channel moved with the seat
  );

  // --- reset-ids: the operator wipes the seats; rejoin gets a fresh id ---
  resetOperator.emit(EVENTS.resetIds);

  // The reset's closing broadcast lists no clients — the deterministic
  // signal that seats are cleared and performers are bounced.
  await waitForState(
    resetOperator,
    (state) => state.clients.length === 0,
  );

  const freshJoin = await joinWithToken(performerToken);
  t.after(() => freshJoin.socket.close());

  assert.equal(freshJoin.data.id, 1); // no seat: smallest free id
  assert.equal(freshJoin.data.recovered, false);

  const freshState = await waitForState(
    freshJoin.socket,
    (state) => state.clients.length === 1 && state.clients[0].id === 1,
  );

  assert.equal(freshState.clients[0].out, 1); // odd id default channel

  // --- pages served on both ports ---
  const performerResponse = await fetch(`${PERFORMER_URL}/`);
  const monitorResponse = await fetch(`${MONITOR_URL}/`);

  assert.equal(performerResponse.status, 200);
  assert.equal(monitorResponse.status, 200);

  const monitorHtml = await monitorResponse.text();
  assert.match(monitorHtml, /monitor\.js/);

  // --- theme following (spec §5.3): the monitor branch loads the
  // module from the App-contract namespace; the performer port, which
  // also serves static files, does not expose it ---
  assert.match(monitorHtml, /\/__pnds\/theme-follow\.js/);
  const themeModule = await fetch(`${MONITOR_URL}/__pnds/theme-follow.js`);
  assert.equal(themeModule.status, 200);
  assert.match(themeModule.headers.get("content-type"), /javascript/);
  assert.match(await themeModule.text(), /pnds:theme/);
  const performerThemeModule = await fetch(
    `${PERFORMER_URL}/__pnds/theme-follow.js`,
  );
  assert.equal(performerThemeModule.status, 404);

  // --- locale following (App ≥ v1.3.0): same exposure rules as the
  // theme module ---
  assert.match(monitorHtml, /\/__pnds\/locale-follow\.js/);
  const localeModule = await fetch(`${MONITOR_URL}/__pnds/locale-follow.js`);
  assert.equal(localeModule.status, 200);
  assert.match(localeModule.headers.get("content-type"), /javascript/);
  assert.match(await localeModule.text(), /pnds:locale/);
  const performerLocaleModule = await fetch(
    `${PERFORMER_URL}/__pnds/locale-follow.js`,
  );
  assert.equal(performerLocaleModule.status, 404);

  // --- #138: __config.js carries the entry context. No
  // PNDS_PERFORMER_URL in this spawn, so the performer URL is the HTTP
  // fallback; the ROLE comes from the serving side, never a port
  // comparison; both roles resolve the SAME performer URL ---
  const performerConfig = parseConfigScript(
    await (await fetch(`${PERFORMER_URL}/__config.js`)).text(),
  );
  const monitorConfig = parseConfigScript(
    await (await fetch(`${MONITOR_URL}/__config.js`)).text(),
  );

  assert.equal(performerConfig.role, "performer");
  assert.equal(monitorConfig.role, "monitor");
  assert.equal(performerConfig.projectId, manifest.id);
  assert.equal(monitorConfig.projectId, manifest.id);
  assert.match(performerConfig.performerUrl, /^http:\/\/[^/:]+:\d+\/$/);
  assert.equal(monitorConfig.performerUrl, performerConfig.performerUrl);
});

test("shutdown: SIGTERM completes promptly with live clients still connected", async (t) => {
  // The previous test's teardown signals its server but does not wait
  // for the exit; give the ports a moment before claiming them.
  const portFree = (port) =>
    new Promise((resolve) => {
      const probe = net.connect({ port, host: "127.0.0.1" });

      probe.once("connect", () => {
        probe.destroy();
        resolve(false);
      });
      probe.once("error", () => resolve(true));
    });

  const portsFree = async () =>
    (await portFree(SERVER_CONFIG.performerPort)) &&
    (await portFree(SERVER_CONFIG.monitorPort));

  const deadline = Date.now() + 5000;

  while (Date.now() < deadline && !(await portsFree())) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(await portsFree(), "the previous test's server never released the ports");

  // Isolate seat persistence like the e2e test above: without this the
  // server writes real seat records to the project root, one random token
  // per run, until the file fills up and every fresh join is rejected.
  const seatsFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pnds-seats-shutdown-")),
    "seats.json",
  );

  const server = spawn(process.execPath, ["server.js", "--audio-mode", "none"], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, PNDS_SEATS_FILE: seatsFile },
  });
  t.after(() => server.kill("SIGKILL"));

  await waitForHealthReady();

  // The worst case the App leaves behind on stop: a joined performer
  // (websocket), a polling-only client (a phone on a weak network), and
  // raw keep-alive HTTP connections on both ports (the monitor webview's
  // page stays mounted through the stop fade).
  const performer = await joinWithToken(null);
  t.after(() => performer.socket.close());

  const polling = io(PERFORMER_URL, {
    transports: ["polling"],
    reconnection: false,
  });

  await new Promise((resolve) => polling.once("connect", resolve));
  t.after(() => polling.close());

  const raw = [];

  for (const port of [SERVER_CONFIG.performerPort, SERVER_CONFIG.monitorPort]) {
    const socket = net.connect({ port, host: "127.0.0.1" });

    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write(
      "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n",
    );
    raw.push(socket);
  }
  t.after(() => raw.forEach((s) => s.destroy()));

  const startedAt = Date.now();

  server.kill("SIGTERM");

  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("server did not exit within 2 s of SIGTERM")),
      2000,
    );

    server.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  const elapsed = Date.now() - startedAt;

  // The host's kill window is 5 s (then SIGKILL, and the operator stares
  // at a blank stop cover meanwhile): the server must be long gone
  // before that window closes.
  assert.equal(exitCode, 0, "graceful shutdown completes");
  assert.ok(
    elapsed < 1000,
    `shutdown took ${elapsed} ms with live clients still connected`,
  );
});

// #138: the full performer URL contract. A forwarding entry (the same
// transport shape the App's future HTTPS gateway presents) fronts the
// performer server under one external origin; PNDS_PERFORMER_URL tells
// the server that origin. Phones-to-be load pages and Socket.IO from
// the entry itself, the entry context names the project, and a
// reconnect through the same entry reuses the claim token.
test("full performer URL: one URL everywhere, pages and sockets through a forwarding entry", async (t) => {
  // The earlier tests' teardown signals their servers without waiting
  // for the exits; give the ports a moment before claiming them.
  const portFree = (port) =>
    new Promise((resolve) => {
      const probe = net.connect({ port, host: "127.0.0.1" });

      probe.once("connect", () => {
        probe.destroy();
        resolve(false);
      });
      probe.once("error", () => resolve(true));
    });

  const deadline = Date.now() + 5000;

  while (
    Date.now() < deadline &&
    !(await portFree(SERVER_CONFIG.performerPort))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(
    await portFree(SERVER_CONFIG.performerPort),
    "the earlier tests' servers never released the performer port",
  );

  const seatsFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pnds-seats-entry-")),
    "seats.json",
  );

  const entry = createForwardingEntry(SERVER_CONFIG.performerPort);

  await new Promise((resolve) => entry.server.listen(0, "127.0.0.1", resolve));
  // Same discipline as lib/lifecycle.js closeHttpServer: the phone-side
  // sockets (websockets piped through the entry, fetch keep-alives)
  // would hold close() open — drop them once we stop listening.
  // closeAllConnections() refuses upgraded connections, so the entry's
  // own closeUpgraded() drops the websocket pipes with them.
  t.after(() =>
    new Promise((resolve) => {
      entry.server.close(() => resolve());
      entry.server.closeAllConnections();
      entry.closeUpgraded();
    }),
  );

  const entryUrl = `http://127.0.0.1:${entry.server.address().port}`;
  // The App-injected full URL, exactly as the entry publishes it.
  const performerUrl = `${entryUrl}/`;

  const server = spawn(process.execPath, ["server.js", "--audio-mode", "none"], {
    cwd: PROJECT_ROOT,
    stdio: "ignore",
    env: {
      ...process.env,
      PNDS_SEATS_FILE: seatsFile,
      PNDS_HOST_IP: "127.0.0.1",
      PNDS_PERFORMER_URL: performerUrl,
    },
  });
  t.after(() => server.kill("SIGTERM"));

  await waitForHealthReady();

  // --- page resources through the entry: the phone's whole origin ---
  const page = await fetch(`${entryUrl}/`);

  assert.equal(page.status, 200);

  const socketIoScript = await fetch(`${entryUrl}/socket.io/socket.io.js`);

  assert.equal(socketIoScript.status, 200);
  assert.match(socketIoScript.headers.get("content-type"), /javascript/);

  // --- the entry context: role from the serving side (the entry's
  // port is NOT the manifest's — a port comparison could never be
  // trusted here), the ONE full URL, and the project identity ---
  const entryConfig = parseConfigScript(
    await (await fetch(`${entryUrl}/__config.js`)).text(),
  );

  assert.equal(entryConfig.role, "performer");
  assert.equal(entryConfig.performerUrl, performerUrl);
  assert.equal(entryConfig.projectId, manifest.id);

  // The internal monitor port resolves the SAME URL and its own role.
  const monitorConfig = parseConfigScript(
    await (await fetch(`${MONITOR_URL}/__config.js`)).text(),
  );

  assert.equal(monitorConfig.role, "monitor");
  assert.equal(monitorConfig.performerUrl, performerUrl);

  // The QR endpoint keeps serving its PNG on the monitor side.
  const qr = await fetch(`${MONITOR_URL}/qr`);

  assert.equal(qr.status, 200);
  assert.match(qr.headers.get("content-type"), /image\/png/);

  // --- message round-trip through the entry, polling transport ---
  // Each transport is verified deterministically through the entry.
  // (The polling → websocket upgrade MIX is the future gateway's own
  // test surface: behind an added-latency hop the upgrade race window
  // widens and a late poll trips engine.io's TRANSPORT_MISMATCH.)
  const first = await joinWithToken(null, entryUrl, {
    transports: ["polling"],
  });
  t.after(() => first.socket.close());

  assert.equal(first.data.id, 1);

  first.socket.emit(EVENTS.control, { amp: 0.5, freq: 0.5 });

  const expectedMidFreq = Math.round(
    freqRange.min + 0.5 * (freqRange.max - freqRange.min),
  );

  const controlState = await waitForState(
    first.socket,
    (state) =>
      state.clients.length === 1 &&
      state.clients[0].amp === 0.25 &&
      state.clients[0].freq === expectedMidFreq,
  );

  assert.equal(controlState.clients[0].out, 1);

  // --- same-origin reconnect over the WebSocket transport: the claim
  // token rejoins through the entry and recovers the same seat ---
  first.socket.close();

  const rejoined = await joinWithToken(first.data.token, entryUrl, {
    transports: ["websocket"],
  });
  t.after(() => rejoined.socket.close());

  assert.equal(rejoined.data.id, 1);
});
