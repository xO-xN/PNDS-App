const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Server } = require("socket.io");
const { io } = require("socket.io-client");
const { attachPlayers } = require("../modules/players/protocol");
const { connectPlayer, connectObserver } = require("../modules/players/client");
const { PlayerRegistry } = require("../modules/players/players");
const { SeatsStore } = require("../modules/players/seats-store");

const events = {
  join: "work:join",
  joined: "work:joined",
  rejected: "work:rejected",
  control: "work:control",
  action: "work:action",
  state: "work:state",
};

function storage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
  };
}

async function until(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("observable result did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function project(t, policy, options = {}) {
  const { listenPort = 0, ...protocolOptions } = options;
  const httpServer = http.createServer();
  const server = new Server(httpServer);
  const players = attachPlayers(server, { events, policy, ...protocolOptions });
  await new Promise((resolve) => httpServer.listen(listenPort, "127.0.0.1", resolve));
  t.after(async () => {
    await players.close();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    server,
    players,
    origin: `http://127.0.0.1:${httpServer.address().port}`,
  };
}

function performer(t, origin, options = {}) {
  const client = connectPlayer({
    io,
    origin,
    events,
    storage: storage(),
    tokenKey: "this-work-claim",
    socketOptions: { transports: ["websocket"] },
    ...options,
  });
  t.after(() => client.close());
  return client;
}

test("published players accepts shared work identities, rejects by policy, and observers never join", async (t) => {
  let tokenNumber = 0;
  const live = new Set();
  const policy = {
    join({ socketId, payload }) {
      if (payload.permission === "deny") return { status: "rejected", reason: "Work is closed" };
      live.add(socketId);
      return { token: `claim-${++tokenNumber}`, identity: "ensemble" };
    },
    release({ socketId }) { live.delete(socketId); },
    snapshot() { return { count: live.size }; },
  };
  const { origin } = await project(t, policy);
  const observer = connectObserver({ io, origin, events });
  t.after(() => observer.close());
  await until(() => observer.connected && observer.state !== null);
  assert.deepEqual(observer.state, { count: 0 });

  const first = performer(t, origin);
  const second = performer(t, origin);
  await until(() => first.joined && second.joined && observer.state.count === 2);
  assert.equal(first.identity, "ensemble");
  assert.equal(second.identity, "ensemble");
  const denied = performer(t, origin, { makeJoin: (token) => ({ token, permission: "deny" }) });
  await until(() => denied.rejectedReason !== null);
  assert.equal(denied.joined, false);
  assert.equal(denied.rejectedReason, "Work is closed");
  assert.deepEqual(observer.state, { count: 2 });
  first.close();
  await until(() => observer.state.count === 1);
});

test("unjoined sends are dropped and repeated controls/actions deliver when filtering is not chosen", async (t) => {
  const controls = [];
  const actions = [];
  const { origin } = await project(t, {
    join() { return { token: "unfiltered-token", identity: { role: "audience" } }; },
    release() {},
    control(context, payload) { controls.push({ identity: context.identity, payload }); },
    action(context, payload) { actions.push(payload); },
    snapshot() { return { controls, actions }; },
  });
  const client = performer(t, origin);
  assert.equal(client.sendControls({ level: 0.5 }), false);
  assert.equal(client.sendAction({ start: true }), false);
  await until(() => client.joined);
  const observer = connectObserver({ io, origin, events });
  t.after(() => observer.close());
  client.sendControls({ level: 0.5 });
  client.sendControls({ level: 0.5 });
  client.sendAction({ start: true });
  client.sendAction({ start: true });
  await until(() => observer.state && observer.state.actions.length === 2);
  assert.deepEqual(observer.state, {
    controls: [
      { identity: { role: "audience" }, payload: { level: 0.5 } },
      { identity: { role: "audience" }, payload: { level: 0.5 } },
    ],
    actions: [{ start: true }, { start: true }],
  });
});

test("chosen continuous deadband drops repeated/tiny controls, keeps actions, and resets on reconnect", async (t) => {
  const controls = [];
  let actionCount = 0;
  const known = new Set();
  const { origin } = await project(t, {
    join({ token }) {
      const recovered = known.has(token);
      const claim = token || "filtered-claim";
      known.add(claim);
      return { token: claim, identity: "no-seat", recovered };
    },
    release() {},
    control(context, payload) { controls.push(payload); },
    action() { actionCount++; },
    snapshot() { return { controls, actionCount }; },
  });
  const client = performer(t, origin, { continuousFilter: { threshold: 0.125 } });
  const observer = connectObserver({ io, origin, events });
  t.after(() => observer.close());
  await until(() => client.joined);
  assert.equal(client.sendControls({ level: 0.5 }), true);
  assert.equal(client.sendControls({ level: 0.5 }), false);
  assert.equal(client.sendControls({ level: 0.55 }), false);
  assert.equal(client.sendControls({ level: 0.625 }), true);
  assert.equal(client.sendControls({ level: 0.6, register: "alto" }), true);
  client.sendAction({ strike: 1 });
  client.sendAction({ strike: 1 });
  await until(() => observer.state && observer.state.actionCount === 2);
  assert.deepEqual(observer.state.controls, [{ level: 0.5 }, { level: 0.625 }, { level: 0.6, register: "alto" }]);
  client.reconnect();
  assert.equal(client.joined, false);
  assert.equal(client.sendControls({ level: 0.6, register: "alto" }), false);
  await until(() => client.joined && client.recovered);
  assert.equal(client.identity, "no-seat");
  assert.equal(client.sendControls({ level: 0.6, register: "alto" }), true);
  await until(() => observer.state.controls.length === 4);
});

test("closing during async admission releases the work claim and cannot deliver a late joined event", async (t) => {
  let start;
  let admit;
  const started = new Promise((resolve) => { start = resolve; });
  const pending = new Promise((resolve) => { admit = resolve; });
  let released = null;
  const { origin, players } = await project(t, {
    async join() { start(); await pending; return { token: "pending-claim", identity: "shared" }; },
    release(context) { released = context.identity; },
  });
  const client = performer(t, origin);
  let joined = false;
  client.onChange((state) => { joined ||= state.joined; });
  await started;
  const closed = players.close();
  admit();
  await closed;
  assert.equal(released, "shared");
  assert.equal(joined, false);
  await until(() => !client.connected);
  assert.equal(client.sendAction({ strike: true }), false);
  client.close();
  assert.equal(client.reconnect(), false);
});

function exclusiveSeatPolicy(file) {
  const registry = new PlayerRegistry({ maxClients: 4 });
  const seats = new SeatsStore({ file });
  const controls = new Map(); // transient work values, not disk records
  return {
    join({ socketId, token }) {
      const seat = seats.get(token);
      const result = registry.allocate({ socketId, claimToken: token, preferredId: seat ? seat.id : null, reservedIds: seats.reservedIds(seat ? seat.id : null) });
      if (result.status === "rejected") return { status: "rejected", reason: result.message };
      const output = seat ? seat.out : 7; // distinct from seat, no voice mapping
      seats.record(result.token, { id: result.id, out: output });
      return { token: result.token, identity: { seat: result.id, output }, recovered: Boolean(seat), restore: controls.get(result.token) || null };
    },
    control({ token }, payload) { controls.set(token, payload); },
    snapshot() { return { values: [...controls.values()] }; },
    release({ socketId }) { registry.releaseBySocket(socketId); },
  };
}

test("explicit seat policy restores same-origin claim after reconnect/restart, while controls stay session-local", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pnds-module-claims-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "claims.json");
  const memory = storage();
  const firstProject = await project(t, exclusiveSeatPolicy(file));
  const first = performer(t, firstProject.origin, { storage: memory });
  await until(() => first.joined);
  assert.deepEqual(first.identity, { seat: 1, output: 7 });
  assert.equal(first.recovered, false);
  const observer = connectObserver({ io, origin: firstProject.origin, events });
  t.after(() => observer.close());
  first.sendControls({ level: 0.75 });
  await until(() => observer.state && observer.state.values.length === 1);
  first.reconnect();
  await until(() => first.joined && first.recovered);
  assert.deepEqual(first.restore, { level: 0.75 });
  first.close();
  await firstProject.players.close();

  const restarted = await project(t, exclusiveSeatPolicy(file));
  const returning = performer(t, restarted.origin, { storage: memory });
  await until(() => returning.joined);
  assert.deepEqual(returning.identity, { seat: 1, output: 7 });
  assert.equal(returning.recovered, true);
  assert.equal(returning.restore, null);

  // A different browser origin has its own localStorage instance.
  const newOriginStorage = storage();
  const newcomer = performer(t, restarted.origin, { storage: newOriginStorage });
  await until(() => newcomer.joined);
  assert.deepEqual(newcomer.identity, { seat: 2, output: 7 });
  assert.notEqual(newOriginStorage.getItem("this-work-claim"), memory.getItem("this-work-claim"));
});

test("optional exclusive registry policy takes over a moved seat using the same claim", async (t) => {
  const registry = new PlayerRegistry({ maxClients: 4 });
  const { origin } = await project(t, {
    join({ socketId, token }) {
      const assignment = registry.allocate({ socketId, claimToken: token });
      return { token: assignment.token, identity: assignment.id };
    },
    action({ identity }, payload) { registry.reassign(identity, payload.moveTo); },
    release({ socketId }) { registry.releaseBySocket(socketId); },
    snapshot() { return { seats: registry.list().map((entry) => entry.id) }; },
  });
  const memory = storage();
  const first = performer(t, origin, { storage: memory });
  await until(() => first.joined);
  const observer = connectObserver({ io, origin, events });
  t.after(() => observer.close());
  first.sendAction({ moveTo: 4 });
  await until(() => observer.state && observer.state.seats[0] === 4);
  const takeover = performer(t, origin, { storage: memory });
  await until(() => takeover.joined);
  assert.equal(takeover.identity, 4);
  assert.deepEqual(observer.state, { seats: [4] });
});

test("transport loss automatically reconnects the same player and observer to a restarted project origin", async (t) => {
  const remembered = new Set();
  const policy = () => ({
    join({ token }) {
      const claim = token || "same-origin-claim";
      const recovered = remembered.has(claim);
      remembered.add(claim);
      return { token: claim, identity: "unseated", recovered };
    },
    release() {},
    snapshot() { return { running: true }; },
  });
  const initial = await project(t, policy());
  const socketOptions = { reconnectionDelay: 10, reconnectionDelayMax: 20 };
  const client = performer(t, initial.origin, { socketOptions });
  const observer = connectObserver({ io, origin: initial.origin, events, socketOptions });
  t.after(() => observer.close());
  const connectionStates = [];
  client.onChange((state) => connectionStates.push(state.connected));
  await until(() => client.joined && observer.connected);
  await initial.server.close();
  await until(() => !client.connected && !observer.connected);
  assert.equal(client.sendControls({ level: 1 }), false);
  await project(t, policy(), { listenPort: Number(new URL(initial.origin).port) });
  await until(() => client.joined && client.recovered && observer.connected);
  assert.equal(client.identity, "unseated");
  assert.ok(connectionStates.includes(false));
});

test("a work can adapt join/rejection wire envelopes without adopting Template id/out fields", async (t) => {
  const { origin } = await project(t, {
    join({ token, payload }) {
      if (payload.role !== "guest") return { status: "rejected", reason: "Choose a role" };
      return { token: token || "wire-adapted-claim", identity: ["chorus", "percussion"], restore: { density: 0.4 } };
    },
    release() {},
  }, {
    readToken: (payload) => payload.claim,
    makeJoined: ({ token, identity, restore }) => ({ claim: token, member: identity, last: restore }),
    makeRejected: (reason) => ({ message: reason }),
  });
  const accepted = performer(t, origin, {
    makeJoin: (token) => ({ claim: token, role: "guest" }),
    readJoined: (payload) => ({ token: payload.claim, identity: payload.member, restore: payload.last }),
  });
  await until(() => accepted.joined);
  assert.deepEqual(accepted.identity, ["chorus", "percussion"]);
  assert.deepEqual(accepted.restore, { density: 0.4 });
  const denied = performer(t, origin, { readRejected: (payload) => `localized:${payload.message}` });
  await until(() => denied.rejectedReason !== null);
  assert.equal(denied.rejectedReason, "localized:Choose a role");
});

test("unavailable claim storage is observable and reconnect can still reuse the current in-memory claim", async (t) => {
  const { origin } = await project(t, {
    join({ token }) { return { token: token || "memory-only-claim", identity: "listener", recovered: token === "memory-only-claim" }; },
    release() {},
  });
  const unavailable = {
    getItem() { throw new Error("Storage denied"); },
    setItem() { throw new Error("Storage denied"); },
  };
  const client = performer(t, origin, { storage: unavailable });
  await until(() => client.joined);
  assert.match(client.error, /Storage denied/);
  client.reconnect();
  await until(() => client.joined && client.recovered);
  assert.equal(client.identity, "listener");
});
