// Only declared low-frequency view keys, held for this server session.
function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  seen.add(value);
  const valid = Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function attachMonitorState(namespace, { events, defaults = {}, validators = {} }) {
  for (const key of ["monitorSnapshot", "monitorSet", "monitorState"]) {
    if (!events || typeof events[key] !== "string" || !events[key]) {
      throw new Error(`monitor-state needs events.${key}`);
    }
  }
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults) || !isJsonValue(defaults)) {
    throw new Error("monitor-state defaults must be a JSON object");
  }
  const state = JSON.parse(JSON.stringify(defaults));
  const declared = new Set(Object.keys(state));
  const handlers = new Map();
  let closed = false;
  function snapshot() { return JSON.parse(JSON.stringify(state)); }
  function connection(socket) {
    const reject = (reason) => { if (events.monitorError) socket.emit(events.monitorError, { reason }); };
    const set = (payload) => {
      if (!payload || Array.isArray(payload) || typeof payload.key !== "string" || payload.value === undefined) {
        reject("Invalid view update"); return;
      }
      if (!declared.has(payload.key)) { reject("Unknown view key"); return; }
      try {
        if (!isJsonValue(payload.value) || (Object.hasOwn(validators, payload.key) && !validators[payload.key](payload.value, snapshot()))) {
          reject("Invalid view value"); return;
        }
      } catch { reject("Invalid view value"); return; }
      state[payload.key] = JSON.parse(JSON.stringify(payload.value));
      namespace.emit(events.monitorState, snapshot());
    };
    const disconnect = () => {
      socket.off(events.monitorSet, set);
      socket.off("disconnect", disconnect);
      handlers.delete(socket);
    };
    handlers.set(socket, disconnect);
    socket.on(events.monitorSet, set);
    socket.on("disconnect", disconnect);
    socket.emit(events.monitorSnapshot, snapshot());
  }
  namespace.on("connection", connection);
  return {
    snapshot,
    close() {
      if (closed) return;
      closed = true;
      namespace.off("connection", connection);
      for (const [socket, detach] of handlers) {
        detach();
        socket.disconnect(false);
      }
      handlers.clear();
    },
  };
}

module.exports = { attachMonitorState };
