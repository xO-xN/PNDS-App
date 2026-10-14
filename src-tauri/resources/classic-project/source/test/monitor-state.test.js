// Monitor view-state contract tests against a fake Socket.IO namespace
// — no process spawn, no ports. The fake mirrors just the surface the
// module uses (namespace.on/emit, socket.on/emit), so the snapshot /
// set / broadcast semantics run through the same code the server wires
// onto io.of("/monitor"). Wire-level delivery to every copy is
// socket.io's job; the integration test covers it against the real
// server.

const { test } = require("node:test");
const assert = require("node:assert");

const { attachMonitorState } = require("../lib/monitor-state");
const shared = require("../public/shared");

const { events: EVENTS } = shared;

class FakeSocket {
  constructor() {
    this.handlers = new Map();
    this.sent = [];
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }

    this.handlers.get(event).push(handler);
  }

  // Server → this one client (the snapshot).
  emit(event, payload) {
    this.sent.push({ event, payload });
  }

  // Test-side: a client-side emit arriving at the server.
  receive(event, payload) {
    for (const handler of this.handlers.get(event) || []) {
      handler(payload);
    }
  }
}

function createFakeNamespace() {
  const connectionHandlers = [];
  const sockets = [];
  const broadcasts = [];

  return {
    sockets,
    broadcasts,

    on(event, handler) {
      if (event === "connection") {
        connectionHandlers.push(handler);
      }
    },

    // Namespace-wide broadcast: recorded, not fan-delivered (see the
    // header — delivery is the integration seam's to prove).
    emit(event, payload) {
      broadcasts.push({ event, payload });
    },

    connect() {
      const socket = new FakeSocket();

      for (const handler of connectionHandlers) {
        handler(socket);
      }

      sockets.push(socket);
      return socket;
    },
  };
}

test("a connecting copy receives the declared defaults as its snapshot", () => {
  const namespace = createFakeNamespace();

  attachMonitorState(namespace, {
    events: EVENTS,
    defaults: { showQr: true },
  });

  const socket = namespace.connect();

  assert.deepStrictEqual(socket.sent, [
    { event: EVENTS.monitorSnapshot, payload: { showQr: true } },
  ]);
  assert.deepStrictEqual(namespace.broadcasts, []);
});

test("set of a declared key updates state and broadcasts it namespace-wide", () => {
  const namespace = createFakeNamespace();
  const monitorState = attachMonitorState(namespace, {
    events: EVENTS,
    defaults: { showQr: true },
  });

  const socket = namespace.connect();

  socket.receive(EVENTS.monitorSet, { key: "showQr", value: false });

  assert.deepStrictEqual(namespace.broadcasts, [
    { event: EVENTS.monitorState, payload: { showQr: false } },
  ]);
  assert.deepStrictEqual(monitorState.snapshot(), { showQr: false });

  // A copy connecting later (a reload, the projection window opened
  // mid-show) receives the CURRENT state, not the defaults.
  const late = namespace.connect();

  assert.deepStrictEqual(late.sent, [
    { event: EVENTS.monitorSnapshot, payload: { showQr: false } },
  ]);
});

test("values pass through opaquely — null, strings, numbers, objects", () => {
  const namespace = createFakeNamespace();
  const monitorState = attachMonitorState(namespace, {
    events: EVENTS,
    defaults: { pick: null, label: "", zoom: 1 },
  });

  const socket = namespace.connect();

  socket.receive(EVENTS.monitorSet, { key: "pick", value: null });
  socket.receive(EVENTS.monitorSet, { key: "label", value: "minimal" });
  socket.receive(EVENTS.monitorSet, { key: "zoom", value: 2 });
  socket.receive(EVENTS.monitorSet, { key: "pick", value: { any: "shape" } });

  assert.deepStrictEqual(monitorState.snapshot(), {
    pick: { any: "shape" },
    label: "minimal",
    zoom: 2,
  });
  assert.strictEqual(namespace.broadcasts.length, 4);
});

test("undeclared keys are ignored — they stay purely page-local", () => {
  const namespace = createFakeNamespace();
  const monitorState = attachMonitorState(namespace, {
    events: EVENTS,
    defaults: { showQr: true },
  });

  const socket = namespace.connect();
  namespace.broadcasts.length = 0;

  socket.receive(EVENTS.monitorSet, { key: "hoverHighlight", value: true });

  assert.deepStrictEqual(namespace.broadcasts, []);
  assert.deepStrictEqual(monitorState.snapshot(), { showQr: true });
});

test("malformed set payloads change nothing and broadcast nothing", () => {
  const namespace = createFakeNamespace();
  const monitorState = attachMonitorState(namespace, {
    events: EVENTS,
    defaults: { showQr: true },
  });

  const socket = namespace.connect();
  namespace.broadcasts.length = 0;

  socket.receive(EVENTS.monitorSet, null);
  socket.receive(EVENTS.monitorSet, { key: "showQr" }); // missing value
  socket.receive(EVENTS.monitorSet, { value: false }); // missing key
  socket.receive(EVENTS.monitorSet, {
    key: "constructor", // Object.prototype name, not a declared key
    value: 1,
  });

  assert.deepStrictEqual(namespace.broadcasts, []);
  assert.deepStrictEqual(monitorState.snapshot(), { showQr: true });
});
