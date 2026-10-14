// Monitor view state: the score server as the single source of truth.
//
// The same monitor URL is loaded as several live copies — the App's
// main window, the projection window, a ⌘⇧R reload, a browser tab —
// and view adjustments made in one used to die there: every other copy
// kept its own defaults. This module moves the state to the server:
// any copy connecting receives the current snapshot, and any copy's
// adjustment is rebroadcast to all of them.
//
// Memory rules (the two other stores in the template for contrast):
//   - voice state (lastControls in protocol.js): in-memory, survives
//     phone locks, dies on restart.
//   - seat registry (seats-store.js): on disk, survives restarts.
//   - view state (here): in-memory AND session-scoped by design —
//     every performance starts from the work's defaults, inheriting
//     nothing from the previous run's debugging. Nothing here is ever
//     written to disk.
//
// Wire protocol: three events, names from public/shared.js via the
// caller (each work keeps its own wire vocabulary).
//   connect               → the server emits events.monitorSnapshot with
//                           the FULL state to that socket (a fresh copy
//                           renders the current state, never a local
//                           default first).
//   events.monitorSet     → { key, value } from any copy. Only keys the
//                           work declared in `defaults` are stored — that
//                           declaration IS the opt-in, so a page keeps any
//                           purely local state (hover highlights, transient
//                           UI) by simply not declaring it. Undeclared or
//                           malformed sets are ignored.
//   events.monitorState   → the FULL state after the change, broadcast to
//                           every copy on the namespace (latest-value-wins,
//                           idempotent application — same philosophy as the
//                           theme bridge).
//
// The namespace IS the scope: the caller passes io.of("/monitor") and
// performer pages never connect there, so they cannot receive these
// broadcasts — no allowlist to maintain, nothing for a performer test
// to observe. Values pass through opaquely (the set of keys is the
// work's vocabulary); the full-state payload keeps copies converging
// even if a broadcast is missed, because the next snapshot carries
// everything.

function attachMonitorState(namespace, { events, defaults = {} }) {
  const state = { ...defaults };

  function snapshot() {
    return { ...state };
  }

  namespace.on("connection", (socket) => {
    socket.emit(events.monitorSnapshot, snapshot());

    socket.on(events.monitorSet, (payload) => {
      if (
        !payload ||
        typeof payload.key !== "string" ||
        !Object.hasOwn(defaults, payload.key) ||
        payload.value === undefined
      ) {
        return;
      }

      state[payload.key] = payload.value;

      namespace.emit(events.monitorState, snapshot());
    });
  });

  return { snapshot };
}

module.exports = {
  attachMonitorState,
};
