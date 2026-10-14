// Independent browser/Node connector. No seat, voice or output assumptions.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.PNDSPlayers = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function changedBeyond(previous, next, threshold) {
    if (!previous || !next || typeof next !== "object" || Array.isArray(next)) return true;
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      const before = previous[key];
      const after = next[key];
      if (Object.is(before, after)) continue;
      if (Number.isFinite(before) && Number.isFinite(after)) {
        if (Math.abs(before - after) >= threshold) return true;
      } else return true;
    }
    return false;
  }
  function connectPlayer({
    io, origin, events, tokenKey, storage,
    socketOptions = {},
    makeJoin = (token) => ({ token }),
    readJoined = (payload) => payload,
    readRejected = (payload) => payload && payload.reason,
    continuousFilter = null,
  }) {
    if (!storage || typeof tokenKey !== "string" || !tokenKey) {
      throw new Error("connectPlayer needs a work-specific tokenKey and storage");
    }
    if (continuousFilter && (!Number.isFinite(continuousFilter.threshold) || continuousFilter.threshold < 0)) {
      throw new Error("continuousFilter.threshold must be a finite nonnegative number");
    }
    const socket = io(origin, { reconnection: true, ...socketOptions, autoConnect: false });
    const listeners = new Set();
    const handlers = [];
    const state = { connected: false, joined: false, identity: null, rejectedReason: null, recovered: false, restore: null, error: null };
    let closed = false;
    let lastSent = null;
    let claimToken = null;
    function notify() { for (const listener of listeners) listener({ ...state }); }
    function listen(event, handler) { socket.on(event, handler); handlers.push([event, handler]); }
    listen("connect", () => {
      state.connected = true;
      state.joined = false;
      lastSent = null;
      notify();
      try { claimToken = storage.getItem(tokenKey) || claimToken; }
      catch (error) { state.error = `Claim storage unavailable: ${error.message}`; notify(); }
      try { socket.emit(events.join, makeJoin(claimToken)); }
      catch (error) { state.error = `Join payload failed: ${error.message}`; notify(); }
    });
    listen(events.joined, (payload) => {
      let assignment;
      try { assignment = readJoined(payload); }
      catch (error) { state.error = `Joined payload failed: ${error.message}`; notify(); return; }
      if (!assignment || typeof assignment.token !== "string" || assignment.identity === undefined) return;
      claimToken = assignment.token;
      Object.assign(state, { joined: true, identity: assignment.identity, rejectedReason: null, recovered: Boolean(assignment.recovered), restore: assignment.restore ?? null, error: null });
      try { storage.setItem(tokenKey, claimToken); }
      catch (error) { state.error = `Claim storage unavailable: ${error.message}`; }
      notify();
    });
    listen(events.rejected, (payload) => {
      let reason = "Rejected";
      try { reason = readRejected(payload) || reason; }
      catch (error) { state.error = `Rejected payload failed: ${error.message}`; }
      Object.assign(state, { joined: false, identity: null, rejectedReason: reason, recovered: false, restore: null });
      notify();
    });
    listen("disconnect", () => {
      Object.assign(state, { connected: false, joined: false, identity: null, restore: null });
      lastSent = null;
      notify();
    });
    listen("connect_error", (error) => { state.error = error.message; notify(); });
    socket.connect();
    return {
      get connected() { return state.connected; },
      get joined() { return state.joined; },
      get identity() { return state.identity; },
      get rejectedReason() { return state.rejectedReason; },
      get recovered() { return state.recovered; },
      get restore() { return state.restore; },
      get error() { return state.error; },
      onChange(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
      sendControls(payload) {
        if (closed || !state.joined || !socket.connected || !events.control) return false;
        if (continuousFilter && !changedBeyond(lastSent, payload, continuousFilter.threshold)) return false;
        socket.emit(events.control, payload);
        lastSent = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : null;
        return true;
      },
      sendAction(payload) {
        if (closed || !state.joined || !socket.connected || !events.action) return false;
        socket.emit(events.action, payload);
        return true;
      },
      reconnect() {
        if (closed) return false;
        socket.disconnect();
        socket.connect();
        return true;
      },
      close() {
        if (closed) return;
        closed = true;
        for (const [event, handler] of handlers) socket.off(event, handler);
        socket.close();
        Object.assign(state, { connected: false, joined: false, identity: null, restore: null });
        notify();
        listeners.clear();
      },
    };
  }

  function connectObserver({ io, origin, events, socketOptions = {} }) {
    const socket = io(origin, { reconnection: true, ...socketOptions, autoConnect: false });
    const listeners = new Set();
    let state = null;
    let closed = false;
    const receive = (payload) => { state = payload; for (const listener of listeners) listener(payload); };
    socket.on(events.state, receive);
    socket.connect();
    return {
      get connected() { return socket.connected; },
      get state() { return state; },
      onState(listener) { listeners.add(listener); if (state !== null) listener(state); return () => listeners.delete(listener); },
      close() { if (closed) return; closed = true; socket.off(events.state, receive); socket.close(); listeners.clear(); },
    };
  }
  return { connectPlayer, connectObserver };
});
