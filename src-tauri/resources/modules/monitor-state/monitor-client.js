// Separate browser global: can coexist with modules/players/client.js.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.PNDSMonitorState = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function connectMonitorState({ io, origin, namespace, events, socketOptions = {} }) {
    if (typeof namespace !== "string" || !namespace.startsWith("/") || namespace === "/") {
      throw new Error("connectMonitorState needs a dedicated namespace such as /monitor");
    }
    const socket = io(origin.replace(/\/$/, "") + namespace, { reconnection: true, ...socketOptions, autoConnect: false });
    const listeners = new Set();
    let viewState = null;
    let closed = false;
    let error = null;
    const copy = () => viewState === null ? null : JSON.parse(JSON.stringify(viewState));
    const receive = (payload) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      viewState = payload;
      for (const listener of listeners) listener(copy());
    };
    const disconnect = () => {
      viewState = null;
      for (const listener of listeners) listener(null);
    };
    const rejected = (payload) => { error = (payload && payload.reason) || "View update rejected"; };
    socket.on(events.monitorSnapshot, receive);
    socket.on(events.monitorState, receive);
    socket.on("disconnect", disconnect);
    if (events.monitorError) socket.on(events.monitorError, rejected);
    socket.connect();
    return {
      get connected() { return socket.connected; },
      get viewState() { return copy(); },
      get error() { return error; },
      onViewState(listener) { listeners.add(listener); listener(copy()); return () => listeners.delete(listener); },
      setViewState(key, value) {
        if (closed || !socket.connected || viewState === null) return false;
        error = null;
        socket.emit(events.monitorSet, { key, value });
        return true;
      },
      reconnect() { if (closed) return false; socket.disconnect(); socket.connect(); return true; },
      close() {
        if (closed) return;
        closed = true;
        socket.off(events.monitorSnapshot, receive);
        socket.off(events.monitorState, receive);
        socket.off("disconnect", disconnect);
        if (events.monitorError) socket.off(events.monitorError, rejected);
        socket.close();
        viewState = null;
        listeners.clear();
      },
    };
  }
  return { connectMonitorState };
});
