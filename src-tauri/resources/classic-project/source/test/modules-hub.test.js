const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { spawn } = require("node:child_process");
const net = require("node:net");
const { io } = require("socket.io-client");
const { createHubConnection } = require("../modules/hub/hub");

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(get, predicate = value => value, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await get(); if (predicate(value)) return value; } catch { /* process still starting */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("observable state timed out");
}
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const fallback = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("exit", () => { clearTimeout(fallback); resolve(); });
    child.kill("SIGTERM");
  });
}
async function hub(t, port) {
  port = port || await freePort();
  const process = spawn(global.process.execPath, [path.resolve(__dirname, "../fixtures/modules/hub/hub.cjs")], { env: { ...global.process.env, HUB_PORT: String(port), HUB_HOST: "127.0.0.1", HUB_TOKEN: "fixture-token" }, stdio: "ignore" });
  t.after(() => stop(process));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}`)).ok);
  return { process, port, url: `http://127.0.0.1:${port}` };
}

test("released hub connection exposes configuration, authentication and idempotent lifecycle without tokens", async (t) => {
  const center = await hub(t);
  const unconfigured = createHubConnection({ environment: {} });
  unconfigured.start();
  assert.equal(unconfigured.snapshot().status, "unconfigured");
  const statuses = [];
  const link = createHubConnection({ environment: { PNDS_NODE_ID: " site-a ", PNDS_HUB_URL: center.url, PNDS_HUB_TOKEN: "wrong-secret", PNDS_HUB_ROOM: "water_1" }, onStatus: state => statuses.push(state.status), reconnectionDelayMs: 100 });
  t.after(() => link.stop());
  link.start(); link.start();
  await waitFor(() => link.snapshot(), state => state.status === "authentication-failed");
  assert.equal(link.snapshot().reason, "invalid-token");
  assert.equal(JSON.stringify(link.snapshot()).includes("wrong-secret"), false);
  assert.ok(statuses.includes("connecting"));
  link.stop(); link.stop();
  assert.equal(link.snapshot().status, "stopped");
  assert.equal(link.send("touch", { value: 1 }), false);
});

async function node(t, center, name, { room = "water_1", token = "fixture-token" } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.resolve(__dirname, "../fixtures/modules/hub-node.cjs")], { env: { ...process.env, LOCAL_PORT: String(port), PNDS_NODE_ID: name, PNDS_HUB_URL: center.url, PNDS_HUB_TOKEN: token, PNDS_HUB_ROOM: room }, stdio: "ignore" });
  t.after(() => stop(child));
  const url = `http://127.0.0.1:${port}`;
  const state = async () => (await fetch(`${url}/state`)).json();
  await waitFor(state);
  return { state, url, child, post: async (route, body) => (await fetch(`${url}/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() };
}
async function performer(t, node) {
  const socket = io(node.url, { reconnection: false });
  t.after(() => socket.close());
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  const joined = await socket.emitWithAck("join");
  assert.deepEqual(joined, { joined: true });
  return socket;
}

test("two real score nodes relay project events and summaries while room and own echoes stay isolated", async (t) => {
  const center = await hub(t);
  const a = await node(t, center, "site-a");
  const b = await node(t, center, "site-b");
  const otherRoom = await node(t, center, "site-c", { room: "water_2" });
  const phoneA = await performer(t, a);
  const phoneB = await performer(t, b);
  await waitFor(a.state, state => state.hub.remoteNodeCount === 1);
  const state = await waitFor(b.state, state => state.hub.remoteNodeCount === 1);
  assert.equal(state.hub.peers[0].nodeId, "site-a");
  assert.deepEqual(state.hub.peers[0].summary, { role: "ensemble", performers: ["phone-one", "phone-two"] });
  assert.deepEqual(await phoneA.emitWithAck("control", { touch: 0.7 }), { accepted: true, relayed: true });
  const event = await waitFor(b.state, state => state.received.length === 1);
  assert.deepEqual(event.received[0].payload, { touch: 0.7 });
  assert.equal(event.received[0].event, "gesture");
  assert.equal(event.received[0].sender.from, "site-a");
  assert.equal(typeof event.received[0].sender.hubReceivedAt, "number");
  assert.equal((await a.state()).received.length, 0);
  assert.equal((await otherRoom.state()).received.length, 0);
  assert.equal((await otherRoom.state()).hub.remoteNodeCount, 0);
  assert.deepEqual(await phoneB.emitWithAck("control", { touch: 0.2 }), { accepted: true, relayed: true });
  await waitFor(a.state, state => state.received.length === 1);

  // The existing hub allows duplicate display names. A stamped self identity is ignored.
  const duplicate = io(center.url, { reconnection: false, auth: { token: "fixture-token", room: "water_1", node: "site-a" } });
  t.after(() => duplicate.close());
  await new Promise(resolve => duplicate.once("connect", resolve));
  duplicate.emit("relay", { type: "pnds:hub-event", version: 1, event: "gesture", payload: "echo", from: "forged-name" });
  const stamped = await waitFor(b.state, state => state.received.length === 2);
  assert.equal(stamped.received[1].sender.from, "site-a");
  assert.equal((await a.state()).received.length, 1);

  await b.post("hub-stop", {});
  const offline = await a.post("clock", { offset: 2500 });
  assert.equal(offline.remoteNodeCount, 0);
  assert.equal(offline.peers[0].online, false);
  const expired = await a.post("clock", { offset: 6000 });
  assert.deepEqual(expired.peers, []);
  assert.equal((await b.state()).hub.status, "stopped");
});

test("hub loss, refusal and recovery leave local performer joining and controls available", async (t) => {
  const center = await hub(t);
  const a = await node(t, center, "site-a");
  const b = await node(t, center, "site-b");
  const refused = await node(t, center, "wrong-token", { token: "invalid" });
  await waitFor(a.state, state => state.hub.connected);
  await waitFor(b.state, state => state.hub.connected);
  await waitFor(refused.state, state => state.hub.status === "authentication-failed");
  const rejectedPhone = await performer(t, refused);
  assert.deepEqual(await rejectedPhone.emitWithAck("control", { local: "refused hub" }), { accepted: true, relayed: false });
  await stop(center.process);
  await waitFor(a.state, state => state.hub.status === "disconnected" || state.hub.status === "unreachable");
  const phone = await performer(t, a);
  assert.deepEqual(await phone.emitWithAck("control", { local: "hub down" }), { accepted: true, relayed: false });
  const restarted = await hub(t, center.port);
  assert.equal(restarted.url, center.url);
  await waitFor(a.state, state => state.hub.connected && state.hub.remoteNodeCount === 1);
  await waitFor(b.state, state => state.hub.connected);
  assert.deepEqual(await phone.emitWithAck("control", { local: "hub recovered" }), { accepted: true, relayed: true });
  await waitFor(b.state, state => state.received.some(event => event.payload.local === "hub recovered"));
  await a.post("hub-stop", {});
  assert.deepEqual(await phone.emitWithAck("control", { local: "hub stopped" }), { accepted: true, relayed: false });
  assert.deepEqual((await a.state()).hub.peers, []);
});

test("Host config takes authority as a unit and unavailable standalone hub does not delay local controls", async (t) => {
  const partial = createHubConnection({ environment: { PNDS_NODE_ID: "Host node" }, config: { nodeId: "standalone", url: "http://127.0.0.1:1", token: "secret", room: "wrong_1" } });
  partial.start();
  assert.equal(partial.snapshot().status, "unconfigured");
  assert.equal(partial.snapshot().nodeId, "Host node");
  const unavailable = await node(t, { url: `http://127.0.0.1:${await freePort()}` }, "standalone-site");
  await waitFor(unavailable.state, state => state.hub.status === "unreachable");
  const phone = await performer(t, unavailable);
  assert.deepEqual(await phone.emitWithAck("control", { local: "never-connected hub" }), { accepted: true, relayed: false });
});
