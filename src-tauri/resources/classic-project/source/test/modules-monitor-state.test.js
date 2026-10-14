const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const { Server } = require("socket.io");
const { io } = require("socket.io-client");
const { attachMonitorState } = require("../modules/monitor-state/monitor-state");
const { connectMonitorState } = require("../modules/monitor-state/monitor-client");
const { attachPlayers } = require("../modules/players/protocol");
const { connectPlayer, connectObserver } = require("../modules/players/client");

const events = {
  monitorSnapshot: "views:snapshot",
  monitorSet: "views:set",
  monitorState: "views:state",
  monitorError: "views:error",
};

async function until(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("observable result did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function project(t, options = {}) {
  const httpServer = http.createServer();
  const server = new Server(httpServer);
  const channel = attachMonitorState(server.of("/view"), {
    events,
    defaults: { showQr: true, selection: null },
    ...options,
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    channel.close();
    await new Promise((resolve) => server.close(resolve));
  });
  return { server, channel, origin: `http://127.0.0.1:${httpServer.address().port}` };
}

function monitor(t, origin, options = {}) {
  const client = connectMonitorState({ io, origin, namespace: "/view", events, ...options });
  t.after(() => client.close());
  return client;
}

test("published monitor channel gives defaults, broadcasts to all copies, heals late/reconnected copies, and isolates performers", async (t) => {
  const { origin } = await project(t);
  const performer = io(origin);
  t.after(() => performer.close());
  const leaked = [];
  performer.on(events.monitorState, (state) => leaked.push(state));
  performer.on(events.monitorSnapshot, (state) => leaked.push(state));
  const first = monitor(t, origin);
  const second = monitor(t, origin);
  assert.equal(first.viewState, null);
  assert.equal(first.setViewState("showQr", false), false);
  await until(() => first.viewState && second.viewState && performer.connected);
  assert.deepEqual(first.viewState, { showQr: true, selection: null });
  assert.equal(first.setViewState("showQr", false), true);
  assert.deepEqual(first.viewState, { showQr: true, selection: null });
  await until(() => first.viewState.showQr === false && second.viewState.showQr === false);
  const late = monitor(t, origin);
  await until(() => late.viewState);
  assert.deepEqual(late.viewState, { showQr: false, selection: null });
  first.reconnect();
  assert.equal(first.viewState, null);
  second.setViewState("selection", { part: "strings" });
  await until(() => first.viewState && first.viewState.selection);
  assert.deepEqual(first.viewState, { showQr: false, selection: { part: "strings" } });
  assert.deepEqual(leaked, []);
});

test("declared validators reject malformed/unknown updates and snapshots cannot mutate the shared state", async (t) => {
  const { origin } = await project(t, {
    validators: { showQr: (value) => typeof value === "boolean" },
  });
  const client = monitor(t, origin);
  await until(() => client.viewState);
  client.setViewState("hoverHighlight", true);
  await until(() => client.error !== null);
  assert.equal(client.error, "Unknown view key");
  client.setViewState("showQr", "not a boolean");
  await until(() => client.error !== null);
  assert.equal(client.error, "Invalid view value");
  client.setViewState("showQr", undefined);
  await until(() => client.error !== null);
  assert.equal(client.error, "Invalid view update");
  assert.deepEqual(client.viewState, { showQr: true, selection: null });
  client.viewState.showQr = false;
  client.viewState.hoverHighlight = true;
  const late = monitor(t, origin);
  await until(() => late.viewState);
  assert.deepEqual(late.viewState, { showQr: true, selection: null });
});

test("view subscribers receive independent values and closing/recreating the channel resets session defaults", async (t) => {
  const { server, channel, origin } = await project(t);
  const client = monitor(t, origin);
  client.onViewState((state) => { if (state) state.showQr = false; });
  await until(() => client.viewState);
  assert.deepEqual(client.viewState, { showQr: true, selection: null });
  client.setViewState("showQr", false);
  await until(() => client.viewState.showQr === false);
  channel.close();
  await until(() => !client.connected && client.viewState === null);
  assert.equal(client.setViewState("showQr", true), false);
  const fresh = attachMonitorState(server.of("/view"), { events, defaults: { showQr: true, selection: null } });
  t.after(() => fresh.close());
  client.reconnect();
  await until(() => client.viewState);
  assert.deepEqual(client.viewState, { showQr: true, selection: null });
  client.close();
  assert.equal(client.reconnect(), false);
});

test("players and monitor-state modules wire together independently without monitor identity allocation", async (t) => {
  const { server, origin } = await project(t);
  const playerEvents = { join: "join", joined: "joined", rejected: "rejected", state: "players" };
  const live = new Set();
  const players = attachPlayers(server, {
    events: playerEvents,
    policy: {
      join({ socketId }) { live.add(socketId); return { token: "one-claim", identity: "choir" }; },
      release({ socketId }) { live.delete(socketId); },
      snapshot() { return { performers: live.size }; },
    },
  });
  t.after(() => players.close());
  const observer = connectObserver({ io, origin, events: playerEvents });
  t.after(() => observer.close());
  const view = monitor(t, origin);
  await until(() => observer.state && view.viewState);
  assert.deepEqual(observer.state, { performers: 0 });
  const values = new Map();
  const performer = connectPlayer({ io, origin, events: playerEvents, tokenKey: "piece-claim", storage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) } });
  t.after(() => performer.close());
  await until(() => performer.joined && observer.state.performers === 1);
  view.setViewState("showQr", false);
  await until(() => view.viewState.showQr === false);
  assert.deepEqual(observer.state, { performers: 1 });
  await players.close();
  assert.equal(view.connected, true);
  view.setViewState("showQr", true);
  await until(() => view.viewState.showQr === true);
});
